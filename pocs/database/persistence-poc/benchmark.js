import pg from 'pg';
import mariadb from 'mariadb';
import { MongoClient } from 'mongodb';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const db = process.argv[2];

const N = 10000;
const Q = 1000;
const RUNS = 5;
const file = 'results.json';

const read = () => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

if (db === 'report') {
  const results = read();
  const dbs = ['postgres', 'mariadb', 'mongodb'];
  const missing = dbs.filter(name => !results[name]);

  if (missing.length) {
    console.error('Missing benchmark results:', missing.join(', '));
    process.exit(1);
  }

  for (const key of Object.keys(results.postgres?.metrics ?? {})) {
    console.table(
      Object.fromEntries(
        dbs.map(name => [name, results[name].metrics[key]])
      )
    );

    console.log(key, '(milliseconds)');
  }

  console.table(
    Object.fromEntries(
      dbs.map(name => [name, results[name].checks])
    )
  );

  process.exit(0);
}

const users = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `user-${i + 1}`
}));

const rows = Array.from({ length: N }, (_, i) => ({
  id: i + 1,
  userId: i % 100 + 1,
  name: `workflow-${i + 1}`,
  enabled: true,
  config: {
    trigger: i % 2 ? 'github.push' : 'timer.tick',
    reaction: 'discord.send_message'
  }
}));

const ids = Array.from(
  { length: Q },
  (_, i) => (i * 7919) % N + 1
);

const owners = Array.from(
  { length: Q },
  (_, i) => i % 100 + 1
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isPg = db === 'postgres';
const isMongo = db === 'mongodb';

let conn;
let client;
let mongo;
let sql;

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      if (isMongo) {
        client = new MongoClient(
          'mongodb://127.0.0.1:17017/bench?directConnection=true&replicaSet=rs0&w=majority&journal=true',
          { serverSelectionTimeoutMS: 2000 }
        );

        await client.connect();

        mongo = client.db('bench');

        const hello = await mongo.command({ hello: 1 });

        if (!hello.isWritablePrimary) {
          throw Error('Not primary');
        }
      } else if (isPg) {
        conn = new pg.Client({
          host: '127.0.0.1',
          port: 15433,
          user: 'bench',
          password: 'bench',
          database: 'bench'
        });

        await conn.connect();

        sql = async (statement, params = []) => (
          await conn.query(
            statement.replace(/\?/g, () => `$${++sql.idx}`),
            params
          )
        ).rows;
      } else {
        conn = await mariadb.createConnection({
          host: '127.0.0.1',
          port: 13307,
          user: 'bench',
          password: 'bench',
          database: 'bench'
        });

        sql = (statement, params = []) => conn.query(statement, params);
      }

      return;
    } catch (error) {
      await client?.close().catch(() => {});
      await conn?.end().catch(() => {});

      if (i === 59) {
        throw error;
      }

      await sleep(1000);
    }
  }
}

async function query(statement, params = []) {
  sql.idx = 0;
  return sql(statement, params);
}

async function setup() {
  if (isMongo) {
    await mongo.dropDatabase();

    await mongo.collection('users').createIndex(
      { id: 1 },
      { unique: true }
    );

    await mongo.collection('workflows').createIndex(
      { id: 1 },
      { unique: true }
    );

    await mongo.collection('workflows').createIndex({ userId: 1 });
    await mongo.collection('users').insertMany(users);

    return;
  }

  await query('DROP TABLE IF EXISTS workflows');
  await query('DROP TABLE IF EXISTS users');

  await query(
    'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL)'
  );

  await query(`
    CREATE TABLE workflows (
      id INT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      enabled BOOLEAN NOT NULL,
      config ${isPg ? 'JSONB' : 'JSON'} NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await query('CREATE INDEX workflow_owner ON workflows(user_id)');

  const placeholders = users.map(() => '(?,?)').join(',');
  const values = users.flatMap(user => [user.id, user.name]);

  await query(
    `INSERT INTO users (id,name) VALUES ${placeholders}`,
    values
  );
}

async function insert(batch, session) {
  if (isMongo) {
    const documents = batch.map(workflow => ({
      ...workflow,
      config: { ...workflow.config }
    }));

    return mongo.collection('workflows').insertMany(
      documents,
      { session }
    );
  }

  const placeholders = batch.map(() => '(?,?,?,?,?)').join(',');

  const values = batch.flatMap(workflow => [
    workflow.id,
    workflow.userId,
    workflow.name,
    workflow.enabled,
    JSON.stringify(workflow.config)
  ]);

  return query(
    `INSERT INTO workflows (id,user_id,name,enabled,config) VALUES ${placeholders}`,
    values
  );
}

async function count(id) {
  if (isMongo) {
    return mongo.collection('workflows').countDocuments({ id });
  }

  const result = await query(
    'SELECT COUNT(*) AS n FROM workflows WHERE id=?',
    [id]
  );

  return Number(result[0].n);
}

async function timed(callback) {
  const start = performance.now();

  await callback();

  return performance.now() - start;
}

const samples = {
  insert: [],
  select: [],
  update: [],
  relationships: [],
  jsonFilter: []
};

async function benchmarkInsert() {
  return timed(async () => {
    for (let i = 0; i < N; i += 500) {
      await insert(rows.slice(i, i + 500));
    }
  });
}

async function benchmarkSelect() {
  return timed(async () => {
    for (const id of ids) {
      const result = isMongo
        ? await mongo.collection('workflows').findOne({ id })
        : await query(
            'SELECT * FROM workflows WHERE id=?',
            [id]
          );

      if (isMongo ? !result : result.length !== 1) {
        throw Error('Missing workflow');
      }
    }
  });
}

async function benchmarkUpdate() {
  return timed(async () => {
    for (const id of ids) {
      if (isMongo) {
        await mongo.collection('workflows').updateOne(
          { id },
          { $set: { enabled: false } }
        );
      } else {
        await query(
          'UPDATE workflows SET enabled=false WHERE id=?',
          [id]
        );
      }
    }
  });
}

async function benchmarkRelationships() {
  return timed(async () => {
    for (const id of owners) {
      const result = isMongo
        ? await mongo.collection('workflows').aggregate([
            { $match: { userId: id } },
            {
              $lookup: {
                from: 'users',
                localField: 'userId',
                foreignField: 'id',
                as: 'owner'
              }
            },
            { $unwind: '$owner' }
          ]).toArray()
        : await query(
            'SELECT w.*,u.name AS owner FROM workflows w JOIN users u ON w.user_id=u.id WHERE w.user_id=?',
            [id]
          );

      if (result.length !== 100) {
        throw Error('Unexpected relationship count');
      }
    }
  });
}

async function benchmarkJsonFilter() {
  return timed(async () => {
    for (let i = 0; i < 20; i++) {
      const result = isMongo
        ? await mongo.collection('workflows').countDocuments({
            'config.trigger': 'github.push'
          })
        : Number((await query(
            isPg
              ? "SELECT COUNT(*) AS n FROM workflows WHERE config->>'trigger'=?"
              : "SELECT COUNT(*) AS n FROM workflows WHERE JSON_UNQUOTE(JSON_EXTRACT(config,'$.trigger'))=?",
            ['github.push']
          ))[0].n);

      if (result !== 5000) {
        throw Error('Unexpected JSON count');
      }
    }
  });
}

async function checkRollback(probe) {
  if (isMongo) {
    const session = client.startSession();

    try {
      session.startTransaction();

      await insert([probe], session);
      await session.abortTransaction();
    } finally {
      await session.endSession();
    }
  } else {
    await query('START TRANSACTION');

    try {
      await insert([probe]);
    } finally {
      await query('ROLLBACK');
    }
  }

  return (await count(probe.id)) === 0;
}

async function checkForeignKey(probe) {
  let rejected = false;

  try {
    await insert([
      { ...probe, userId: 999999 }
    ]);
  } catch (error) {
    if (isMongo || !(error.code === '23503' || error.errno === 1452)) {
      throw error;
    }

    rejected = true;
  }

  return rejected && (await count(probe.id)) === 0;
}

function getMetrics() {
  const operations = {
    insert: N,
    select: Q,
    update: Q,
    relationships: Q,
    jsonFilter: 20
  };

  return Object.fromEntries(
    Object.entries(samples).map(([key, values]) => {
      const median = [...values].sort((a, b) => a - b)[2];

      const average = values.reduce(
        (sum, value) => sum + value,
        0
      ) / values.length;

      return [
        key,
        {
          medianTotalMs: +median.toFixed(3),
          meanMsPerOperation: +(average / operations[key]).toFixed(4),
          samplesMs: values
        }
      ];
    })
  );
}

try {
  await connect();

  for (let run = -1; run < RUNS; run++) {
    await setup();

    const times = {
      insert: await benchmarkInsert(),
      select: await benchmarkSelect(),
      update: await benchmarkUpdate(),
      relationships: await benchmarkRelationships(),
      jsonFilter: await benchmarkJsonFilter()
    };

    if (run >= 0) {
      for (const key of Object.keys(times)) {
        samples[key].push(times[key]);
      }
    }

    console.log(
      db,
      run < 0 ? 'warmup' : `run ${run + 1}/${RUNS}`,
      times
    );
  }

  const probe = {
    ...rows[0],
    id: N + 1
  };

  const rollback = await checkRollback(probe);
  const integrity = await checkForeignKey(probe);

  const results = read();

  results[db] = {
    metrics: getMetrics(),
    checks: {
      rollback,
      foreignKeyEnforced: integrity
    },
    environment: {
      node: process.version,
      cpu: os.cpus()[0]?.model,
      platform: os.platform(),
      ramBytes: os.totalmem()
    }
  };

  writeFileSync(
    file,
    JSON.stringify(results, null, 2)
  );
} finally {
  await client?.close();
  await conn?.end();
}
