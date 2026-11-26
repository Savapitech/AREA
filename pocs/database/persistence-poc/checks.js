import pg from 'pg';
import mariadb from 'mariadb';
import { MongoClient } from 'mongodb';
import { execFileSync, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';

const target = process.argv[2];
const file = 'results.json';

const DEDUP_WORKERS = 20;
const DEDUP_ATTEMPTS = 5;
const JOBS = 200;
const JOB_WORKERS = 4;
const INDEX_ROWS = 100000;

const read = () => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

const save = (key, value) => {
  const results = read();
  results[key] = { ...(results[key] ?? {}), ...value };
  writeFileSync(file, JSON.stringify(results, null, 2));
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const timed = async callback => {
  const start = performance.now();
  const value = await callback();
  return { value, ms: +(performance.now() - start).toFixed(1) };
};

const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return { ok: result.status === 0, out: result.stdout, err: result.stderr };
};

async function defaults() {
  const startsWithoutPassword = async (image, readyPattern) => {
    const name = `area-defaults-${image.replace(/[^a-z0-9]/g, '-')}`;
    docker('rm', '-f', name);
    docker('run', '-d', '--name', name, image);
    let logs = '';
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const output = docker('logs', name);
      logs = `${output.out}${output.err}`;
      const running = docker('inspect', '-f', '{{.State.Running}}', name).out.trim() === 'true';
      if (!running || readyPattern.test(logs)) {
        return { name, running, logs };
      }
    }
    return { name, running: true, logs };
  };

  const postgres = await startsWithoutPassword('postgres:17', /ready to accept connections/);
  docker('rm', '-f', postgres.name);
  const mariadbResult = await startsWithoutPassword('mariadb:11.4', /ready for connections/);
  docker('rm', '-f', mariadbResult.name);
  const mongo = await startsWithoutPassword('mongo:8', /Waiting for connections/);
  const probe = docker(
    'run', '--rm', '--network', `container:${mongo.name}`, 'mongo:8',
    'mongosh', '--quiet', 'mongodb://127.0.0.1:27017/admin',
    '--eval', 'JSON.stringify(db.adminCommand({ listDatabases: 1 }).databases.map(d => d.name))',
  );
  docker('rm', '-f', mongo.name);

  const firstLine = (logs, pattern) => logs.split('\n').find(line => pattern.test(line))?.trim() ?? null;

  save('defaults', {
    postgres: {
      startsWithoutPassword: postgres.running,
      message: firstLine(postgres.logs, /superuser password|POSTGRES_PASSWORD/),
    },
    mariadb: {
      startsWithoutPassword: mariadbResult.running,
      message: firstLine(mariadbResult.logs, /MARIADB_ROOT_PASSWORD|password option/i),
    },
    mongodb: {
      startsWithoutPassword: mongo.running,
      anonymousAdminAccess: probe.ok && probe.out.includes('admin'),
      databasesListedAnonymously: probe.ok ? JSON.parse(probe.out.trim().split('\n').pop()) : null,
    },
  });
}

function sqlClient(isPg) {
  if (isPg) {
    const pool = new pg.Pool({ host: '127.0.0.1', port: 15433, user: 'bench', password: 'bench', database: 'bench', max: DEDUP_WORKERS });
    const run = async (statement, params = [], client = pool) => {
      let index = 0;
      return (await client.query(statement.replace(/\?/g, () => `$${++index}`), params)).rows;
    };
    return {
      run,
      withConnection: async callback => {
        const client = await pool.connect();
        try {
          return await callback((statement, params) => run(statement, params, client));
        } finally {
          client.release();
        }
      },
      end: () => pool.end(),
    };
  }
  const pool = mariadb.createPool({ host: '127.0.0.1', port: 13307, user: 'bench', password: 'bench', database: 'bench', connectionLimit: DEDUP_WORKERS });
  return {
    run: (statement, params = []) => pool.query(statement, params),
    withConnection: async callback => {
      const connection = await pool.getConnection();
      try {
        return await callback((statement, params = []) => connection.query(statement, params));
      } finally {
        connection.release();
      }
    },
    end: () => pool.end(),
  };
}

const isDuplicate = error => error?.code === '23505' || error?.errno === 1062 || error?.code === 11000;
const isCheckViolation = error => error?.code === '23514' || error?.errno === 4025 || error?.code === 121;

async function sqlChecks(isPg) {
  const db = sqlClient(isPg);
  const json = isPg ? 'JSONB' : 'JSON';
  const out = {};

  try {
    for (const table of ['jobs', 'hook_events', 'service_connections', 'area_workflows', 'area_users']) {
      await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('CREATE TABLE area_users (id INT PRIMARY KEY, email VARCHAR(100) NOT NULL UNIQUE)');
    await db.run(`
      CREATE TABLE area_workflows (
        id INT PRIMARY KEY,
        user_id INT NOT NULL,
        config ${json} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES area_users(id) ON DELETE CASCADE,
        CONSTRAINT workflow_has_trigger CHECK (${isPg ? "config->'trigger' IS NOT NULL" : "JSON_CONTAINS_PATH(config, 'one', '$.trigger')"})
      )
    `);
    await db.run(`
      CREATE TABLE service_connections (
        id INT PRIMARY KEY,
        user_id INT NOT NULL,
        service VARCHAR(50) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES area_users(id) ON DELETE CASCADE
      )
    `);
    await db.run(`
      CREATE TABLE hook_events (
        id ${isPg ? 'SERIAL' : 'INT AUTO_INCREMENT'} PRIMARY KEY,
        source VARCHAR(50) NOT NULL,
        external_id VARCHAR(100) NOT NULL,
        UNIQUE (source, external_id)
      )
    `);
    await db.run(`CREATE TABLE jobs (id INT PRIMARY KEY, claimed_by INT NULL)`);

    let duplicates = 0;
    await Promise.all(Array.from({ length: DEDUP_WORKERS }, () => db.withConnection(async run => {
      for (let i = 0; i < DEDUP_ATTEMPTS; i++) {
        try {
          await run('INSERT INTO hook_events (source, external_id) VALUES (?, ?)', ['github', 'push-42']);
        } catch (error) {
          if (!isDuplicate(error)) {
            throw error;
          }
          duplicates++;
        }
      }
    })));
    const stored = Number((await db.run("SELECT COUNT(*) AS n FROM hook_events WHERE external_id = 'push-42'"))[0].n);
    out.hookDedup = { attempts: DEDUP_WORKERS * DEDUP_ATTEMPTS, stored, rejectedAsDuplicate: duplicates, ok: stored === 1 };

    await db.run("INSERT INTO area_users (id, email) VALUES (1, 'alice@example.com'), (2, 'bob@example.com')");
    await db.run(`INSERT INTO area_workflows (id, user_id, config) VALUES (1, 1, ?), (2, 1, ?), (3, 1, ?), (4, 2, ?)`,
      Array(4).fill(JSON.stringify({ trigger: 'timer.tick' })));
    await db.run("INSERT INTO service_connections (id, user_id, service) VALUES (1, 1, 'github')");

    let rejected = false;
    try {
      await db.run('INSERT INTO area_workflows (id, user_id, config) VALUES (?, ?, ?)', [5, 1, JSON.stringify({ reactions: [] })]);
    } catch (error) {
      if (!isCheckViolation(error)) {
        throw error;
      }
      rejected = true;
    }
    out.schemaValidation = { workflowWithoutTriggerRejected: rejected, ok: rejected };

    await db.run('DELETE FROM area_users WHERE id = 1');
    const orphanWorkflows = Number((await db.run('SELECT COUNT(*) AS n FROM area_workflows WHERE user_id = 1'))[0].n);
    const orphanConnections = Number((await db.run('SELECT COUNT(*) AS n FROM service_connections WHERE user_id = 1'))[0].n);
    out.userDeletion = { orphanWorkflows, orphanConnections, ok: orphanWorkflows + orphanConnections === 0 };

    const injected = await db.run('SELECT id FROM area_users WHERE email = ?', [JSON.stringify({ $ne: '' })]);
    let objectParam;
    try {
      objectParam = (await db.run('SELECT id FROM area_users WHERE email = ?', [{ $ne: '' }])).length;
    } catch {
      objectParam = 0;
    }
    out.operatorInjection = { usersReturned: Math.max(injected.length, objectParam), ok: injected.length === 0 && objectParam === 0 };

    const values = Array.from({ length: JOBS }, (_, i) => `(${i + 1}, NULL)`).join(',');
    await db.run(`INSERT INTO jobs (id, claimed_by) VALUES ${values}`);
    const claims = await timed(() => Promise.all(Array.from({ length: JOB_WORKERS }, (_, worker) => db.withConnection(async run => {
      const mine = [];
      for (;;) {
        await run('START TRANSACTION');
        const rows = await run('SELECT id FROM jobs WHERE claimed_by IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED');
        if (rows.length === 0) {
          await run('COMMIT');
          return mine;
        }
        await run('UPDATE jobs SET claimed_by = ? WHERE id = ?', [worker + 1, rows[0].id]);
        await run('COMMIT');
        mine.push(rows[0].id);
      }
    }))));
    const claimed = claims.value.flat();
    out.jobClaim = {
      jobs: JOBS,
      workers: JOB_WORKERS,
      claimed: claimed.length,
      claimedTwice: claimed.length - new Set(claimed).size,
      perWorker: claims.value.map(list => list.length),
      ms: claims.ms,
      ok: claimed.length === JOBS && new Set(claimed).size === JOBS,
    };

    await db.run('DROP TABLE IF EXISTS index_workflows');
    await db.run(`CREATE TABLE index_workflows (id INT PRIMARY KEY, config ${json} NOT NULL)`);
    for (let i = 0; i < INDEX_ROWS; i += 1000) {
      const batch = Array.from({ length: 1000 }, (_, j) => {
        const id = i + j + 1;
        return [id, JSON.stringify({ trigger: id % 100 === 0 ? 'gmail.new_mail' : 'timer.tick', reactions: ['discord.send_message'] })];
      });
      await db.run(`INSERT INTO index_workflows (id, config) VALUES ${batch.map(() => '(?, ?)').join(',')}`, batch.flat());
    }
    const filter = isPg
      ? "SELECT COUNT(*) AS n FROM index_workflows WHERE config->>'trigger' = ?"
      : "SELECT COUNT(*) AS n FROM index_workflows WHERE JSON_UNQUOTE(JSON_EXTRACT(config, '$.trigger')) = ?";
    const query = async sql => {
      const runs = [];
      for (let i = 0; i < 20; i++) {
        runs.push((await timed(() => db.run(sql, ['gmail.new_mail']))).ms);
      }
      return runs.sort((a, b) => a - b)[10];
    };
    const before = await query(filter);
    let indexedFilter = filter;
    if (isPg) {
      await db.run("CREATE INDEX index_workflows_trigger ON index_workflows ((config->>'trigger'))");
      await db.run('ANALYZE index_workflows');
    } else {
      await db.run("ALTER TABLE index_workflows ADD COLUMN trigger_name VARCHAR(100) AS (JSON_UNQUOTE(JSON_EXTRACT(config, '$.trigger'))) VIRTUAL, ADD INDEX index_workflows_trigger (trigger_name)");
      indexedFilter = 'SELECT COUNT(*) AS n FROM index_workflows WHERE trigger_name = ?';
    }
    const after = await query(indexedFilter);
    out.jsonIndex = {
      rows: INDEX_ROWS,
      matching: INDEX_ROWS / 100,
      medianMsWithoutIndex: before,
      medianMsWithIndex: after,
      schemaChangeNeeded: !isPg,
      ok: after < before,
    };

    if (isPg) {
      await db.run('DROP ROLE IF EXISTS area_app');
      await db.run('CREATE ROLE area_app NOLOGIN NOSUPERUSER');
      await db.run('GRANT SELECT ON area_workflows TO area_app');
      await db.run('ALTER TABLE area_workflows ENABLE ROW LEVEL SECURITY');
      await db.run("CREATE POLICY own_workflows ON area_workflows USING (user_id = current_setting('app.user_id')::int)");
      await db.run("INSERT INTO area_users (id, email) VALUES (3, 'carol@example.com')");
      await db.run(`INSERT INTO area_workflows (id, user_id, config) VALUES (6, 3, ?), (7, 3, ?)`, Array(2).fill(JSON.stringify({ trigger: 'timer.tick' })));
      const visible = await db.withConnection(async run => {
        await run('BEGIN');
        await run('SET LOCAL ROLE area_app');
        await run("SELECT set_config('app.user_id', '2', true)");
        const rows = await run('SELECT user_id FROM area_workflows');
        await run('ROLLBACK');
        return rows;
      });
      const total = Number((await db.run('SELECT COUNT(*) AS n FROM area_workflows'))[0].n);
      out.rowLevelSecurity = {
        supported: true,
        totalRows: total,
        visibleToUser2: visible.length,
        ok: visible.length > 0 && visible.every(row => row.user_id === 2),
      };
    } else {
      out.rowLevelSecurity = { supported: false, ok: false };
    }
  } finally {
    await db.end();
  }
  return out;
}

async function mongoChecks() {
  const client = new MongoClient(
    'mongodb://127.0.0.1:17017/bench?directConnection=true&replicaSet=rs0&w=majority&journal=true',
    { maxPoolSize: DEDUP_WORKERS },
  );
  await client.connect();
  const db = client.db('area_checks');
  const out = {};

  try {
    await db.dropDatabase();
    const users = db.collection('users');
    const workflows = db.collection('workflows');
    const connections = db.collection('service_connections');
    const events = db.collection('hook_events');
    const jobs = db.collection('jobs');
    await users.createIndex({ email: 1 }, { unique: true });
    await events.createIndex({ source: 1, externalId: 1 }, { unique: true });

    let duplicates = 0;
    await Promise.all(Array.from({ length: DEDUP_WORKERS }, async () => {
      for (let i = 0; i < DEDUP_ATTEMPTS; i++) {
        try {
          await events.insertOne({ source: 'github', externalId: 'push-42' });
        } catch (error) {
          if (!isDuplicate(error)) {
            throw error;
          }
          duplicates++;
        }
      }
    }));
    const stored = await events.countDocuments({ externalId: 'push-42' });
    out.hookDedup = { attempts: DEDUP_WORKERS * DEDUP_ATTEMPTS, stored, rejectedAsDuplicate: duplicates, ok: stored === 1 };

    await db.command({
      collMod: 'workflows',
      validator: { $jsonSchema: { required: ['userId', 'config'], properties: { config: { bsonType: 'object', required: ['trigger'] } } } },
    }).catch(async () => {
      await db.createCollection('workflows', {
        validator: { $jsonSchema: { required: ['userId', 'config'], properties: { config: { bsonType: 'object', required: ['trigger'] } } } },
      });
    });

    await users.insertMany([{ _id: 1, email: 'alice@example.com' }, { _id: 2, email: 'bob@example.com' }]);
    await workflows.insertMany([1, 2, 3].map(id => ({ _id: id, userId: 1, config: { trigger: 'timer.tick' } })).concat({ _id: 4, userId: 2, config: { trigger: 'timer.tick' } }));
    await connections.insertOne({ _id: 1, userId: 1, service: 'github' });

    let rejected = false;
    try {
      await workflows.insertOne({ _id: 5, userId: 1, config: { reactions: [] } });
    } catch (error) {
      if (error.code !== 121) {
        throw error;
      }
      rejected = true;
    }
    out.schemaValidation = { workflowWithoutTriggerRejected: rejected, ok: rejected };

    await users.deleteOne({ _id: 1 });
    const orphanWorkflows = await workflows.countDocuments({ userId: 1 });
    const orphanConnections = await connections.countDocuments({ userId: 1 });
    out.userDeletion = { orphanWorkflows, orphanConnections, ok: orphanWorkflows + orphanConnections === 0 };

    const body = JSON.parse('{"email": {"$ne": ""}}');
    const found = await users.findOne({ email: body.email });
    out.operatorInjection = { usersReturned: found ? 1 : 0, ok: !found };

    await jobs.insertMany(Array.from({ length: JOBS }, (_, i) => ({ _id: i + 1, claimedBy: null })));
    const claims = await timed(() => Promise.all(Array.from({ length: JOB_WORKERS }, async (_, worker) => {
      const mine = [];
      for (;;) {
        const job = await jobs.findOneAndUpdate({ claimedBy: null }, { $set: { claimedBy: worker + 1 } }, { sort: { _id: 1 } });
        if (!job) {
          return mine;
        }
        mine.push(job._id);
      }
    })));
    const claimed = claims.value.flat();
    out.jobClaim = {
      jobs: JOBS,
      workers: JOB_WORKERS,
      claimed: claimed.length,
      claimedTwice: claimed.length - new Set(claimed).size,
      perWorker: claims.value.map(list => list.length),
      ms: claims.ms,
      ok: claimed.length === JOBS && new Set(claimed).size === JOBS,
    };

    const indexed = db.collection('index_workflows');
    for (let i = 0; i < INDEX_ROWS; i += 1000) {
      await indexed.insertMany(Array.from({ length: 1000 }, (_, j) => {
        const id = i + j + 1;
        return { _id: id, config: { trigger: id % 100 === 0 ? 'gmail.new_mail' : 'timer.tick', reactions: ['discord.send_message'] } };
      }));
    }
    const query = async () => {
      const runs = [];
      for (let i = 0; i < 20; i++) {
        runs.push((await timed(() => indexed.countDocuments({ 'config.trigger': 'gmail.new_mail' }))).ms);
      }
      return runs.sort((a, b) => a - b)[10];
    };
    const before = await query();
    await indexed.createIndex({ 'config.trigger': 1 });
    const after = await query();
    out.jsonIndex = {
      rows: INDEX_ROWS,
      matching: INDEX_ROWS / 100,
      medianMsWithoutIndex: before,
      medianMsWithIndex: after,
      schemaChangeNeeded: false,
      ok: after < before,
    };

    out.rowLevelSecurity = { supported: false, ok: false };
  } finally {
    await client.close();
  }
  return out;
}

function footprint(service) {
  const id = execFileSync('docker', ['compose', 'ps', '-q', service], { encoding: 'utf8' }).trim();
  const memory = docker('stats', '--no-stream', '--format', '{{.MemUsage}}', id).out.split('/')[0].trim();
  const image = docker('image', 'inspect', '-f', '{{.Size}}', docker('inspect', '-f', '{{.Config.Image}}', id).out.trim()).out.trim();
  return { memoryAfterChecks: memory, imageMB: Math.round(Number(image) / 1e6) };
}

if (target === 'defaults') {
  await defaults();
} else if (['postgres', 'mariadb', 'mongodb'].includes(target)) {
  const checks = target === 'mongodb' ? await mongoChecks() : await sqlChecks(target === 'postgres');
  const results = read();
  results[target] = { ...(results[target] ?? {}), area: checks, footprint: footprint(target) };
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(target, Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.ok])));
} else {
  console.error('Usage: node checks.js defaults|postgres|mariadb|mongodb');
  process.exit(1);
}
