import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DrizzleStore } from './drizzle/store.js';
import { PgStore } from './pg/store.js';
import { PrismaStore } from './prisma/store.js';
import type { Store, WorkflowInput } from './store.js';
import { TypeormStore } from './typeorm/store.js';

const root = path.resolve(import.meta.dirname, '..');

const USERS = 50;
const WORKFLOWS_PER_USER = 20;
const REACTIONS = 5;
const LIST_ROUNDS = 4;
const COUNTS = 200;
const OCCURRENCES = 100;
const JOBS = 200;
const WORKERS = 4;

type Target = {
  key: string;
  store: () => Store;
  runtime: string[];
  tooling: string[];
  typecheck: boolean;
};

const targets: Target[] = [
  { key: 'typeorm', store: () => new TypeormStore(), runtime: ['typeorm', 'reflect-metadata', 'pg'], tooling: [], typecheck: true },
  { key: 'prisma', store: () => new PrismaStore(), runtime: ['@prisma/client', '@prisma/adapter-pg'], tooling: ['prisma'], typecheck: true },
  { key: 'drizzle', store: () => new DrizzleStore(), runtime: ['drizzle-orm', 'pg'], tooling: ['drizzle-kit'], typecheck: true },
  { key: 'pg', store: () => new PgStore(), runtime: ['pg'], tooling: [], typecheck: false },
];

const workflow = (index: number): WorkflowInput => ({
  name: `workflow-${String(index).padStart(4, '0')}`,
  trigger: index % 10 === 0 ? 'github.push' : 'timer.tick',
  reactions: Array.from({ length: REACTIONS }, (_, position) => ({
    type: position % 2 ? 'discord.send_message' : 'gmail.send_mail',
    params: { to: `user-${index}@example.com`, step: position + 1, urgent: position === 0 },
  })),
});

const timed = async <T>(callback: () => Promise<T>) => {
  const start = performance.now();
  const value = await callback();
  return { value, ms: +(performance.now() - start).toFixed(1) };
};

const throws = async (callback: () => Promise<unknown>) => {
  try {
    await callback();
    return false;
  } catch {
    return true;
  }
};

async function checks(store: Store) {
  const out: Record<string, { ok: boolean; observed: string }> = {};
  const user = await store.createUser(`owner-${Date.now()}@example.com`);
  const workflowId = await store.createWorkflow(user, { ...workflow(1), reactions: workflow(1).reactions.slice(0, 4) });
  const listed = await store.listWorkflows(user);
  const positions = listed[0]?.nodes.map((node) => node.position).join(',');
  out.workflowWithFourReactions = {
    ok: listed.length === 1 && listed[0].trigger === 'timer.tick' && positions === '1,2,3,4',
    observed: `${listed.length} workflow, nodes ${positions}`,
  };

  const broken = workflow(2);
  broken.reactions[2] = { ...broken.reactions[2], type: null as unknown as string };
  const rejected = await throws(() => store.createWorkflow(user, broken));
  const afterRollback = (await store.listWorkflows(user)).length;
  out.rollbackOfAWorkflowWithAnInvalidNode = { ok: rejected && afterRollback === 1, observed: `rejected ${rejected}, workflows left ${afterRollback}` };

  const noTrigger = await throws(() => store.insertWorkflowWithoutTrigger(user));
  out.workflowWithoutTriggerRefused = { ok: noTrigger, observed: noTrigger ? 'refused' : 'stored' };

  const occurrence = `push-${randomUUID()}`;
  const recorded = await Promise.all(Array.from({ length: OCCURRENCES }, () => store.recordOccurrence('github', occurrence)));
  const accepted = recorded.filter(Boolean).length;
  out.sameOccurrenceRecordedOnce = { ok: accepted === 1, observed: `${accepted} of ${OCCURRENCES} accepted` };

  await store.addJobs(JOBS);
  const claims = await Promise.all(Array.from({ length: WORKERS }, async (_, worker) => {
    const mine: number[] = [];
    for (let job = await store.claimJob(worker + 1); job !== null; job = await store.claimJob(worker + 1)) {
      mine.push(job);
    }
    return mine;
  }));
  const claimed = claims.flat();
  out.jobsClaimedOnce = {
    ok: claimed.length === JOBS && new Set(claimed).size === JOBS,
    observed: `${claimed.length} claimed, ${claimed.length - new Set(claimed).size} twice, split ${claims.map((list) => list.length).join('/')}`,
  };

  await store.connectService(user, 'github');
  await store.deleteUser(user);
  const owned = await store.countOwned(user, [workflowId]);
  out.userDeletionRemovesEverything = {
    ok: owned.workflows + owned.nodes + owned.connections === 0,
    observed: `${owned.workflows} workflows, ${owned.nodes} nodes, ${owned.connections} connections left`,
  };
  return out;
}

async function performance_(store: Store) {
  const users: string[] = [];
  for (let i = 0; i < USERS; i++) {
    users.push(await store.createUser(`perf-${i}-${Date.now()}@example.com`));
  }
  const create = await timed(async () => {
    for (let i = 0; i < USERS * WORKFLOWS_PER_USER; i++) {
      await store.createWorkflow(users[i % USERS], workflow(i));
    }
  });
  const list = await timed(async () => {
    for (let round = 0; round < LIST_ROUNDS; round++) {
      for (const user of users) {
        const workflows = await store.listWorkflows(user);
        if (workflows.length !== WORKFLOWS_PER_USER || workflows.some((item) => item.nodes.length !== REACTIONS)) {
          throw new Error(`${store.name} listed a wrong workflow set`);
        }
      }
    }
  });
  let expected = 0;
  const count = await timed(async () => {
    for (let i = 0; i < COUNTS; i++) {
      expected = await store.countByTrigger('github.push');
    }
  });
  const perOperation = (ms: number, operations: number) => +(ms / operations).toFixed(3);
  return {
    createWorkflowMs: perOperation(create.ms, USERS * WORKFLOWS_PER_USER),
    listWorkflowsMs: perOperation(list.ms, LIST_ROUNDS * USERS),
    countByJsonFieldMs: perOperation(count.ms, COUNTS),
    countIsCorrect: expected === (USERS * WORKFLOWS_PER_USER) / 10,
  };
}

function typecheck(key: string) {
  const files = globSync(`typecheck/${key}/*.ts`, { cwd: root }).sort();
  return Object.fromEntries(files.map((file) => {
    const result = spawnSync('npx', [
      'tsc', '--ignoreConfig', '--noEmit', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'ES2023',
      '--strict', '--strictPropertyInitialization', 'false', '--experimentalDecorators', '--emitDecoratorMetadata',
      '--skipLibCheck', '--types', 'node', file,
    ], { cwd: root, encoding: 'utf8' });
    const name = path.basename(file, '.ts');
    const error = result.stdout.match(/error TS\d+: [^\n]*/)?.[0] ?? null;
    return [name, { compiles: result.status === 0, error }];
  }));
}

function migrations(key: string) {
  const read = (pattern: string) => globSync(pattern, { cwd: root }).sort().map((file) => readFileSync(path.join(root, file), 'utf8'));
  const describe = (generated: string, byHand: string[], down: boolean) => ({
    cascadeGenerated: /ON DELETE CASCADE/i.test(generated),
    checkGenerated: /CHECK \(/.test(generated),
    uniqueGenerated: /UNIQUE/.test(generated),
    sqlWrittenByHand: byHand.length,
    downMigration: down,
  });
  if (key === 'typeorm') {
    const [generated] = read('src/typeorm/migrations/*.ts');
    return describe(generated, [], /async down\(/.test(generated) && /DROP TABLE/.test(generated));
  }
  if (key === 'prisma') {
    const [generated, ...byHand] = read('prisma/migrations/*/migration.sql');
    return describe(generated, byHand, false);
  }
  if (key === 'drizzle') {
    const [generated] = read('drizzle/*.sql');
    return describe(generated, [], false);
  }
  return describe('', read('src/pg/schema.sql'), false);
}

function closure(roots: string[]) {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>;
  };
  const resolve = (from: string, name: string) => {
    for (let base = from; ; base = base.slice(0, base.lastIndexOf('/node_modules/'))) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (lock.packages[candidate]) {
        return candidate;
      }
      if (!base.includes('/node_modules/')) {
        return lock.packages[`node_modules/${name}`] ? `node_modules/${name}` : null;
      }
    }
  };
  const seen = new Set<string>();
  const queue = roots.map((name) => resolve('', name)).filter((entry): entry is string => entry !== null);
  while (queue.length) {
    const entry = queue.pop()!;
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    const info = lock.packages[entry];
    for (const name of Object.keys({ ...info.dependencies, ...info.optionalDependencies })) {
      const next = resolve(entry, name);
      if (next) {
        queue.push(next);
      }
    }
  }
  const size = (dir: string): number => {
    let total = 0;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'node_modules') {
          total += size(full);
        }
      } else if (item.isFile()) {
        total += statSync(full).size;
      }
    }
    return total;
  };
  const bytes = [...seen].reduce((sum, entry) => {
    try {
      return sum + size(path.join(root, entry));
    } catch {
      return sum;
    }
  }, 0);
  return { entries: seen, packages: seen.size, megabytes: +(bytes / 1e6).toFixed(1) };
}

function audit() {
  const result = spawnSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8' });
  try {
    return (JSON.parse(result.stdout).vulnerabilities ?? {}) as Record<string, { severity: string }>;
  } catch {
    return {};
  }
}

const vulnerabilities = audit();
const results: Record<string, unknown> = {
  date: new Date().toISOString().slice(0, 10),
  commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  machine: { cpu: os.cpus()[0]?.model.trim(), node: process.version },
  targets: {},
};

for (const target of targets) {
  const store = target.store();
  console.log(`== ${store.name}`);
  try {
    const setup = await timed(() => store.setup());
    const checkResults = await checks(store);
    console.log(`   checks: ${Object.values(checkResults).filter((check) => check.ok).length}/${Object.keys(checkResults).length}`);
    const performanceResults = await performance_(store);
    console.log(`   create ${performanceResults.createWorkflowMs} ms, list ${performanceResults.listWorkflowsMs} ms, count ${performanceResults.countByJsonFieldMs} ms`);
    const runtime = closure(target.runtime);
    const tooling = closure([...target.runtime, ...target.tooling]);
    const vulnerableIn = (entries: Set<string>) =>
      Object.entries(vulnerabilities)
        .filter(([name]) => [...entries].some((entry) => entry.endsWith(`node_modules/${name}`)))
        .map(([name, info]) => `${name} (${info.severity})`);
    (results.targets as Record<string, unknown>)[target.key] = {
      name: store.name,
      setupMs: setup.ms,
      checks: checkResults,
      performance: performanceResults,
      typecheck: target.typecheck ? typecheck(target.key) : null,
      migrations: migrations(target.key),
      dependencies: {
        runtimePackages: runtime.packages,
        runtimeMegabytes: runtime.megabytes,
        withToolingPackages: tooling.packages,
        withToolingMegabytes: tooling.megabytes,
        runtimeVulnerabilities: vulnerableIn(runtime.entries),
        toolingVulnerabilities: vulnerableIn(tooling.entries).filter((entry) => !vulnerableIn(runtime.entries).includes(entry)),
      },
    };
  } finally {
    await store.close();
  }
}

writeFileSync(path.join(root, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);

type Result = {
  name: string;
  setupMs: number;
  checks: Record<string, { ok: boolean; observed: string }>;
  performance: { createWorkflowMs: number; listWorkflowsMs: number; countByJsonFieldMs: number; countIsCorrect: boolean };
  typecheck: Record<string, { compiles: boolean; error: string | null }> | null;
  migrations: ReturnType<typeof migrations>;
  dependencies: {
    runtimePackages: number;
    runtimeMegabytes: number;
    withToolingPackages: number;
    withToolingMegabytes: number;
    runtimeVulnerabilities: string[];
    toolingVulnerabilities: string[];
  };
};

const list = targets.map((target) => (results.targets as Record<string, Result>)[target.key]);
const header = (...columns: string[]) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
const row = (...cells: (string | number)[]) => `| ${cells.join(' | ')} |\n`;
const labels = list.map((result) => result.name);
const yes = (value: boolean) => (value ? 'yes' : '**no**');
const checkLabels: Record<string, string> = {
  workflowWithFourReactions: 'Workflow with 4 reactions saved and listed in order',
  rollbackOfAWorkflowWithAnInvalidNode: 'Workflow whose third node is invalid leaves nothing',
  workflowWithoutTriggerRefused: 'Workflow without a trigger refused by the database',
  sameOccurrenceRecordedOnce: `Same occurrence recorded ${OCCURRENCES} times concurrently`,
  jobsClaimedOnce: `${JOBS} jobs claimed by ${WORKERS} concurrent workers`,
  userDeletionRemovesEverything: 'Deleting a user removes its workflows, nodes and connections',
};
const typeLabels: Record<string, string> = {
  control: 'Control file without mistake compiles',
  'wrong-column': 'Filter on a column that does not exist is refused',
  'unselected-field': 'Reading a field that was not selected is refused',
  'wrong-json-shape': 'Workflow config of the wrong shape is refused',
};

let markdown = `Run of ${results.date} on commit ${results.commit}, ${(results.machine as { cpu: string }).cpu}, Node.js ${process.version}, PostgreSQL 17.\n\n`;
markdown += '### Behavior\n\n' + header('Check', ...labels);
for (const [key, label] of Object.entries(checkLabels)) {
  markdown += row(label, ...list.map((result) => `${yes(result.checks[key].ok)}, ${result.checks[key].observed}`));
}

markdown += '\n### Type checking\n\n' + header('Mistake', ...labels.slice(0, 3));
for (const [key, label] of Object.entries(typeLabels)) {
  markdown += row(label, ...list.slice(0, 3).map((result) => {
    const file = result.typecheck?.[key];
    if (!file) {
      return 'n/a';
    }
    return key === 'control' ? yes(file.compiles) : yes(!file.compiles);
  }));
}

markdown += '\n### Migrations\n\n' + header('Measure', ...labels);
markdown += row('ON DELETE CASCADE generated from the schema', ...list.map((result) => (result.name === 'pg alone' ? 'written by hand' : yes(result.migrations.cascadeGenerated))));
markdown += row('CHECK on the workflow config generated from the schema', ...list.map((result) => (result.name === 'pg alone' ? 'written by hand' : yes(result.migrations.checkGenerated))));
markdown += row('Unique constraints generated from the schema', ...list.map((result) => (result.name === 'pg alone' ? 'written by hand' : yes(result.migrations.uniqueGenerated))));
markdown += row('SQL files written by hand', ...list.map((result) => result.migrations.sqlWrittenByHand));
markdown += row('Down migration generated', ...list.map((result) => yes(result.migrations.downMigration)));
markdown += row('Time to apply the migrations on an empty database (ms)', ...list.map((result) => result.setupMs));

markdown += `\n### Performance (ms per operation, ${USERS * WORKFLOWS_PER_USER} workflows of ${REACTIONS} reactions)\n\n` + header('Operation', ...labels);
markdown += row('Create a workflow and its nodes in a transaction', ...list.map((result) => result.performance.createWorkflowMs));
markdown += row(`List the ${WORKFLOWS_PER_USER} workflows of a user with their nodes`, ...list.map((result) => result.performance.listWorkflowsMs));
markdown += row('Count the workflows by a JSON field', ...list.map((result) => `${result.performance.countByJsonFieldMs}${result.performance.countIsCorrect ? '' : ' (wrong count)'}`));

markdown += '\n### Dependencies\n\n' + header('Measure', ...labels);
markdown += row('Production packages, driver included', ...list.map((result) => result.dependencies.runtimePackages));
markdown += row('Production size (MB)', ...list.map((result) => result.dependencies.runtimeMegabytes));
markdown += row('Packages with the schema and migration tools', ...list.map((result) => result.dependencies.withToolingPackages));
markdown += row('Size with the tools (MB)', ...list.map((result) => result.dependencies.withToolingMegabytes));
markdown += row('Known vulnerabilities in production packages (npm audit)', ...list.map((result) => result.dependencies.runtimeVulnerabilities.join(', ') || 'none'));
markdown += row('Known vulnerabilities in the tools only (npm audit)', ...list.map((result) => result.dependencies.toolingVulnerabilities.join(', ') || 'none'));

writeFileSync(path.join(root, 'results.md'), markdown);
console.log(markdown);
