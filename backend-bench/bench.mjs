import autocannon from 'autocannon';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bench = import.meta.dirname;
const root = path.resolve(bench, '..');
const { JWT_SECRET, HOOK_SECRET } = process.env;

if (!JWT_SECRET || !HOOK_SECRET) {
  console.error('Run ./run.sh instead of node bench.mjs');
  process.exit(1);
}

const ROUTES = ['/auth/register', '/auth/login', '/auth/me', '/hooks/webhook', '/hooks/events'];
const TIMING_SAMPLES = 20;
const PERF_SECONDS = 10;
const PERF_CONNECTIONS = 50;

const targets = [
  {
    name: 'nestjs',
    label: 'NestJS',
    dir: 'nestJs-poc',
    image: 'area-nestjs-poc',
    imageVar: 'NEST_IMAGE',
    services: ['nest'],
    url: 'http://127.0.0.1:13000',
    sources: ['src/**/*.ts'],
  },
  {
    name: 'express',
    label: 'Express',
    dir: 'express-poc',
    image: 'area-express-poc',
    imageVar: 'EXPRESS_IMAGE',
    services: ['express'],
    url: 'http://127.0.0.1:13001',
    sources: ['src/**/*.ts'],
  },
  {
    name: 'laravel',
    label: 'Laravel',
    dir: 'laravel-poc',
    image: 'area-laravel-poc',
    imageVar: 'LARAVEL_IMAGE',
    services: ['laravel', 'laravel-scheduler'],
    url: 'http://127.0.0.1:18000',
    sources: [
      'app/**/*.php',
      'routes/*.php',
      'bootstrap/app.php',
      'config/poc.php',
      'database/migrations/*hook_events*.php',
    ],
  },
];

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });

const compose = (args, env = {}) => run('docker', ['compose', ...args], { cwd: bench, env: { ...process.env, ...env } });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const round = (value, digits = 1) => Number(value.toFixed(digits));

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function forgeJwt(payload, { secret = JWT_SECRET, alg = 'HS256' } = {}) {
  const unsigned = `${b64({ alg, typ: 'JWT' })}.${b64(payload)}`;
  if (alg === 'none') {
    return `${unsigned}.`;
  }
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

const signature = (body, secret = HOOK_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

async function call(base, method, url, { body, raw, headers = {} } = {}) {
  const init = { method, headers: { Accept: 'application/json', ...headers } };
  if (raw !== undefined || body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = raw ?? JSON.stringify(body);
  }
  const start = performance.now();
  const response = await fetch(base + url, init);
  const text = await response.text();
  const ms = performance.now() - start;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, ms, headers: response.headers };
}

async function waitForApi(base, timeoutMs = 120_000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${base}/docs/openapi.json`);
      if (response.status < 500) {
        return performance.now() - start;
      }
    } catch {
      await sleep(100);
      continue;
    }
    await sleep(100);
  }
  throw new Error(`${base} did not answer within ${timeoutMs} ms`);
}

async function start(target, env = {}) {
  const begin = performance.now();
  compose(['up', '-d', '--no-deps', '--force-recreate', ...target.services], env);
  await waitForApi(target.url);
  return performance.now() - begin;
}

function stop(target) {
  compose(['rm', '-sf', ...target.services]);
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function functional(target) {
  const base = target.url;
  const email = `bench-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery';
  const checks = [];
  const check = (name, expected, response, extra = true) => {
    const ok = expected.includes(response.status) && extra;
    checks.push({ name, expected: expected.join(' or '), observed: response.status, ok });
    return response;
  };

  const registered = check('Register', [201], await call(base, 'POST', '/auth/register', { body: { email, password } }));
  check('Register the same email', [409], await call(base, 'POST', '/auth/register', { body: { email, password } }));
  check('Register with an invalid body', [400, 422], await call(base, 'POST', '/auth/register', { body: { email: 'nope', password: 'x' } }));
  check('Login with a wrong password', [401], await call(base, 'POST', '/auth/login', { body: { email, password: 'wrong-password' } }));
  const login = await call(base, 'POST', '/auth/login', { body: { email, password } });
  check('Login', [200], login, typeof login.json?.access_token === 'string');
  const token = login.json?.access_token;
  const me = await call(base, 'GET', '/auth/me', { headers: auth(token) });
  check('Current user with the token', [200], me, me.json?.id === registered.json?.id);
  check('Current user without a token', [401], await call(base, 'GET', '/auth/me'));

  const webhook = JSON.stringify({ eventId: `evt-${randomUUID()}`, eventType: 'github.push', payload: { ref: 'main' } });
  const first = await call(base, 'POST', '/hooks/webhook', { raw: webhook, headers: { 'X-Hook-Signature': signature(webhook) } });
  check('Signed webhook', [200], first, first.json?.duplicate === false);
  const replay = await call(base, 'POST', '/hooks/webhook', { raw: webhook, headers: { 'X-Hook-Signature': signature(webhook) } });
  check('Same webhook again is flagged as a duplicate', [200], replay, replay.json?.duplicate === true);
  check('Detected events without a token', [401], await call(base, 'GET', '/hooks/events'));

  let events;
  const tickStart = performance.now();
  let firstTickSeconds = null;
  while (performance.now() - tickStart < 90_000) {
    events = await call(base, 'GET', '/hooks/events', { headers: auth(token) });
    if (Array.isArray(events.json) && events.json.some((event) => event.source === 'timer')) {
      firstTickSeconds = round((performance.now() - tickStart) / 1000);
      break;
    }
    await sleep(1000);
  }
  check('Polling hook detected a timer.tick on its own', [200], events, firstTickSeconds !== null);

  return { checks, firstTickSeconds, context: { email, password, token, userId: registered.json?.id } };
}

const LEAK = /node_modules|\.php|\.ts:\d|\bat [\w.<>]+ \(|stack|trace/i;

async function security(target, context) {
  const base = target.url;
  const results = [];
  const record = (attack, expected, observed, isProtected) => results.push({ attack, expected, observed, protected: isProtected });
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: context.userId, email: context.email, iat: now, exp: now + 3600 };

  for (const [attack, token] of [
    ['JWT with "alg": "none"', forgeJwt(claims, { alg: 'none' })],
    ['JWT signed with another secret', forgeJwt(claims, { secret: 'attacker-secret' })],
    ['JWT with a modified payload', `${context.token.split('.')[0]}.${b64({ ...claims, sub: randomUUID() })}.${context.token.split('.')[2]}`],
    ['Expired JWT', forgeJwt({ ...claims, iat: now - 7200, exp: now - 3600 })],
    ['Valid JWT of a user that does not exist', forgeJwt({ ...claims, sub: randomUUID() })],
  ]) {
    const response = await call(base, 'GET', '/auth/me', { headers: auth(token) });
    record(attack, '401', String(response.status), response.status === 401);
  }

  const forcedId = randomUUID();
  const massEmail = `mass-${randomUUID()}@example.com`;
  const mass = await call(base, 'POST', '/auth/register', {
    body: { email: massEmail, password: 'correct-horse-battery', id: forcedId, isAdmin: true, passwordHash: 'x' },
  });
  let massObserved;
  let massProtected;
  if (mass.status === 400 || mass.status === 422) {
    massObserved = `${mass.status}, request rejected`;
    massProtected = true;
  } else if (mass.status === 201 && mass.json?.id !== forcedId) {
    const login = await call(base, 'POST', '/auth/login', { body: { email: massEmail, password: 'correct-horse-battery' } });
    massObserved = `201, extra fields ignored${login.status === 200 ? '' : ', password overwritten'}`;
    massProtected = login.status === 200;
  } else {
    massObserved = `${mass.status}, extra fields applied`;
    massProtected = false;
  }
  record('Mass assignment of id, isAdmin and passwordHash on register', 'rejected or ignored', massObserved, massProtected);

  const injection = await call(base, 'POST', '/auth/login', { body: { email: "' OR '1'='1' --", password: 'whatever-password' } });
  record('SQL injection in the login email', '400 or 422', String(injection.status), [400, 422].includes(injection.status));

  const big = await call(base, 'POST', '/auth/login', {
    raw: JSON.stringify({ email: context.email, password: 'x'.repeat(8), padding: 'x'.repeat(1024 * 1024) }),
  });
  record('1 MiB request body', '413, rejected before parsing', String(big.status), big.status === 413);

  const malformed = await call(base, 'POST', '/auth/login', { raw: '{"email": ' });
  const leaks = LEAK.test(malformed.text);
  record(
    'Malformed JSON body',
    '4xx, no internals in the response',
    `${malformed.status}${leaks ? ', internals in the response' : ''}`,
    malformed.status >= 400 && malformed.status < 500 && !leaks,
  );

  const body = JSON.stringify({ eventId: `evt-${randomUUID()}`, eventType: 'github.push', payload: { ref: 'main' } });
  const tampered = body.replace('main', 'evil');
  for (const [attack, raw, headers] of [
    ['Webhook without a signature', body, {}],
    ['Webhook signed with another secret', body, { 'X-Hook-Signature': signature(body, 'attacker-secret') }],
    ['Webhook body modified after signing', tampered, { 'X-Hook-Signature': signature(body) }],
  ]) {
    const response = await call(base, 'POST', '/hooks/webhook', { raw, headers });
    record(attack, '401', String(response.status), response.status === 401);
  }

  const headers = (await call(base, 'GET', '/auth/me')).headers;
  const poweredBy = headers.get('x-powered-by');
  const server = headers.get('server');
  record(
    'Technology disclosed in response headers',
    'no X-Powered-By',
    [poweredBy && `X-Powered-By: ${poweredBy}`, server && `Server: ${server}`].filter(Boolean).join(', ') || 'none',
    !poweredBy,
  );

  const known = [];
  const unknown = [];
  for (let i = 0; i < TIMING_SAMPLES; i++) {
    known.push((await call(base, 'POST', '/auth/login', { body: { email: context.email, password: 'wrong-password' } })).ms);
    unknown.push((await call(base, 'POST', '/auth/login', { body: { email: `ghost-${randomUUID()}@example.com`, password: 'wrong-password' } })).ms);
  }
  const timing = { knownEmailMs: round(median(known)), unknownEmailMs: round(median(unknown)) };
  const gap = timing.knownEmailMs - timing.unknownEmailMs;
  record(
    'Account enumeration through login response time',
    'same time for known and unknown emails',
    `known ${timing.knownEmailMs} ms, unknown ${timing.unknownEmailMs} ms`,
    Math.abs(gap) < 20,
  );

  return { attacks: results, timing };
}

async function performance_(target, token) {
  const options = { url: `${target.url}/auth/me`, connections: PERF_CONNECTIONS, headers: auth(token) };
  await autocannon({ ...options, duration: 3 });
  const result = await autocannon({ ...options, duration: PERF_SECONDS });
  return {
    requestsPerSecond: Math.round(result.requests.average),
    latencyP50Ms: result.latency.p50,
    latencyP99Ms: result.latency.p99,
    failed: result.errors + result.timeouts + result.non2xx,
  };
}

async function openapi(target) {
  const spec = (await call(target.url, 'GET', '/docs/openapi.json')).json ?? { paths: {} };
  const paths = Object.keys(spec.paths ?? {});
  const operations = Object.values(spec.paths ?? {}).flatMap((item) => Object.values(item));
  const resolve = (schema) => (schema?.$ref ? spec.components?.schemas?.[schema.$ref.split('/').pop()] : schema);
  return {
    version: spec.openapi ?? null,
    documentedRoutes: ROUTES.filter((route) => paths.includes(route)).length,
    expectedRoutes: ROUTES.length,
    describedBodies: operations.filter((operation) => {
      const schema = resolve(operation.requestBody?.content?.['application/json']?.schema);
      return Object.keys(schema?.properties ?? {}).length > 0;
    }).length,
  };
}

async function drift(target) {
  const workdir = mkdtempSync(path.join(os.tmpdir(), 'area-drift-'));
  try {
    execFileSync('sh', ['-c', `git -C "${root}" archive HEAD "${target.dir}" | tar -x -C "${workdir}"`]);
    run('git', ['apply', path.join(bench, 'drift', `${target.name}.patch`)], { cwd: workdir });
    run('docker', ['build', '-q', '-t', `${target.image}:drift`, path.join(workdir, target.dir)]);
    await start({ ...target, services: [target.services[0]] }, { [target.imageVar]: `${target.image}:drift` });
    const route = await call(target.url, 'GET', '/hooks/drift');
    const spec = (await call(target.url, 'GET', '/docs/openapi.json')).json ?? { paths: {} };
    return { routeServed: route.status === 200, routeDocumented: '/hooks/drift' in (spec.paths ?? {}) };
  } finally {
    stop(target);
    rmSync(workdir, { recursive: true, force: true });
  }
}

function countLines(target) {
  const dir = path.join(root, target.dir);
  const files = [...new Set(target.sources.flatMap((pattern) => globSync(pattern, { cwd: dir })))].sort();
  const lines = files.reduce(
    (sum, file) => sum + readFileSync(path.join(dir, file), 'utf8').split('\n').filter((line) => line.trim()).length,
    0,
  );
  return { files: files.length, lines };
}

function dependencies(target) {
  const dir = path.join(root, target.dir);
  if (target.name === 'laravel') {
    const lock = JSON.parse(readFileSync(path.join(dir, 'composer.lock'), 'utf8'));
    let report;
    try {
      report = run('docker', ['run', '--rm', '-v', `${dir}:/app:ro`, '-w', '/app', 'composer:2', 'audit', '--locked', '--no-dev', '--format=json']);
    } catch (error) {
      report = error.stdout;
    }
    const advisories = Object.values(JSON.parse(report).advisories ?? {}).flat();
    return {
      production: lock.packages.length,
      vulnerabilities: advisories.length,
      highOrCritical: advisories.filter((advisory) => ['high', 'critical'].includes(advisory.severity)).length,
    };
  }
  const lock = JSON.parse(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  let report;
  try {
    report = run('npm', ['audit', '--omit=dev', '--json'], { cwd: dir });
  } catch (error) {
    report = error.stdout;
  }
  const counts = JSON.parse(report).metadata?.vulnerabilities ?? {};
  return {
    production: Object.entries(lock.packages).filter(([name, info]) => name && !info.dev).length,
    vulnerabilities: counts.total ?? 0,
    highOrCritical: (counts.high ?? 0) + (counts.critical ?? 0),
  };
}

function footprint(target) {
  return {
    imageMB: Math.round(Number(run('docker', ['image', 'inspect', '-f', '{{.Size}}', target.image]).trim()) / 1e6),
    processes: target.services.length,
    handWritten: countLines(target),
    dependencies: dependencies(target),
  };
}

const yes = (value) => (value ? 'yes' : 'no');

function markdown(results) {
  const list = targets.map((target) => results.targets[target.name]);
  const header = (...columns) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
  const row = (...cells) => `| ${cells.join(' | ')} |\n`;
  const labels = targets.map((target) => target.label);
  let out = `Run of ${results.date}, ${results.machine.cpu}, ${results.machine.cpus} threads, Node.js ${results.machine.node}. Each POC runs alone, limited to 2 CPUs and 512 MB.\n\n`;

  out += '### Functional parity\n\n' + header('Check', ...labels);
  for (const [index, entry] of list[0].functional.checks.entries()) {
    out += row(entry.name, ...list.map((result) => `${result.functional.checks[index].ok ? 'pass' : 'FAIL'} (${result.functional.checks[index].observed})`));
  }
  out += row('Seconds until the first timer.tick', ...list.map((result) => result.functional.firstTickSeconds ?? 'none'));

  out += '\n### Attacks\n\n' + header('Attack', 'Expected', ...labels);
  for (const [index, entry] of list[0].security.attacks.entries()) {
    out += row(entry.attack, entry.expected, ...list.map((result) => {
      const attack = result.security.attacks[index];
      return `${attack.protected ? 'protected' : '**exposed**'}: ${attack.observed}`;
    }));
  }

  out += '\n### API description\n\n' + header('Measure', ...labels);
  out += row('OpenAPI version', ...list.map((result) => result.openapi.version));
  out += row('Routes in the description', ...list.map((result) => `${result.openapi.documentedRoutes} / ${result.openapi.expectedRoutes}`));
  out += row('Request bodies with their fields described', ...list.map((result) => result.openapi.describedBodies));
  out += row('Drift test: new route added in the code only, served', ...list.map((result) => yes(result.drift.routeServed)));
  out += row('Drift test: new route appears in the description', ...list.map((result) => yes(result.drift.routeDocumented)));

  out += '\n### Performance and footprint\n\n' + header('Measure', ...labels);
  out += row('Start until the API answers (s)', ...list.map((result) => round(result.startupMs / 1000)));
  out += row(`GET /auth/me, requests per second (${PERF_CONNECTIONS} connections)`, ...list.map((result) => result.performance.requestsPerSecond));
  out += row('GET /auth/me, latency p50 / p99 (ms)', ...list.map((result) => `${result.performance.latencyP50Ms} / ${result.performance.latencyP99Ms}`));
  out += row('Failed requests', ...list.map((result) => result.performance.failed));
  out += row('Processes to run', ...list.map((result) => result.footprint.processes));
  out += row('Docker image (MB)', ...list.map((result) => result.footprint.imageMB));
  out += row('Production dependencies', ...list.map((result) => result.footprint.dependencies.production));
  out += row('Known vulnerabilities (high or critical)', ...list.map((result) => `${result.footprint.dependencies.vulnerabilities} (${result.footprint.dependencies.highOrCritical})`));
  out += row('Hand written code, files / non blank lines', ...list.map((result) => `${result.footprint.handWritten.files} / ${result.footprint.handWritten.lines}`));
  return out;
}

const results = {
  date: new Date().toISOString().slice(0, 10),
  commit: run('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).trim(),
  machine: { cpu: os.cpus()[0]?.model.trim(), cpus: os.cpus().length, node: process.version, platform: os.platform() },
  targets: {},
};

for (const target of targets) {
  console.log(`== ${target.label}`);
  try {
    const startupMs = await start(target);
    const functionalResult = await functional(target);
    console.log(`   functional: ${functionalResult.checks.filter((entry) => entry.ok).length}/${functionalResult.checks.length}`);
    const securityResult = await security(target, functionalResult.context);
    console.log(`   attacks blocked: ${securityResult.attacks.filter((entry) => entry.protected).length}/${securityResult.attacks.length}`);
    const performanceResult = await performance_(target, functionalResult.context.token);
    console.log(`   GET /auth/me: ${performanceResult.requestsPerSecond} req/s`);
    const openapiResult = await openapi(target);
    stop(target);
    const driftResult = await drift(target);
    console.log(`   drift: served ${yes(driftResult.routeServed)}, documented ${yes(driftResult.routeDocumented)}`);
    const { context, ...functionalReport } = functionalResult;
    results.targets[target.name] = {
      startupMs: round(startupMs),
      functional: functionalReport,
      security: securityResult,
      performance: performanceResult,
      openapi: openapiResult,
      drift: driftResult,
      footprint: footprint(target),
    };
  } finally {
    stop(target);
  }
}

writeFileSync(path.join(bench, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
writeFileSync(path.join(bench, 'results.md'), markdown(results));
console.log(markdown(results));
