import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const results = JSON.parse(readFileSync('results.json', 'utf8'));
const dbs = ['postgres', 'mariadb', 'mongodb'];
const labels = ['PostgreSQL 17', 'MariaDB 11.4', 'MongoDB 8'];
const missing = dbs.filter(db => !results[db]?.metrics || !results[db]?.area) .concat(results.defaults ? [] : ['defaults']);

if (missing.length) {
  console.error('Missing results:', missing.join(', '));
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const environment = results.postgres.environment;
const header = (...columns) => `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
const row = (...cells) => `| ${cells.join(' | ')} |\n`;
const each = callback => dbs.map(db => callback(results[db], db));
const verdict = (ok, text) => `${ok ? 'yes' : '**no**'}${text ? `, ${text}` : ''}`;
const clean = message => message?.replace(/^\S+ \S+ \[\w+\] \[Entrypoint\]: /, '') ?? 'none';

let out = `Run of ${new Date().toISOString().slice(0, 10)} on commit ${commit}, ${environment.cpu}, Node.js ${environment.node}.\n\n`;

out += '### Operations on workflows (median of 5 runs, ms)\n\n' + header('Operation', ...labels);
for (const [key, label] of [
  ['insert', 'Insert 10 000 workflows, batches of 500'],
  ['select', '1 000 lookups by primary key'],
  ['update', '1 000 updates by primary key'],
  ['relationships', '1 000 workflow lists of a user, with the user'],
  ['jsonFilter', '20 counts filtered on a JSON field, no index'],
]) {
  out += row(label, ...each(result => result.metrics[key].medianTotalMs.toFixed(1)));
}

out += '\n### Integrity\n\n' + header('Check', ...labels);
out += row('Rolled back transaction leaves nothing', ...each(result => verdict(result.checks.rollback)));
out += row('Workflow of a user that does not exist is refused', ...each(result => verdict(result.checks.foreignKeyEnforced)));
out += row('Workflow without a trigger is refused by the database', ...each(result => verdict(result.area.schemaValidation.ok)));
out += row('Deleting a user deletes its workflows and service connections', ...each(result => verdict(result.area.userDeletion.ok,
  result.area.userDeletion.ok ? '' : `${result.area.userDeletion.orphanWorkflows} workflows and ${result.area.userDeletion.orphanConnections} connection left`)));

out += '\n### Hooks and workers\n\n' + header('Check', ...labels);
out += row('Same occurrence inserted 100 times by 20 connections, rows stored', ...each(result => verdict(result.area.hookDedup.ok, `${result.area.hookDedup.stored} row, ${result.area.hookDedup.rejectedAsDuplicate} rejected`)));
out += row('200 jobs claimed by 4 concurrent workers, claimed twice', ...each(result => verdict(result.area.jobClaim.ok, `${result.area.jobClaim.claimedTwice}, split ${result.area.jobClaim.perWorker.join('/')}, ${result.area.jobClaim.ms} ms`)));

out += '\n### JSON index (100 000 workflows, 1 000 matching)\n\n' + header('Measure', ...labels);
out += row('Count on the trigger, no index (median, ms)', ...each(result => result.area.jsonIndex.medianMsWithoutIndex));
out += row('Count on the trigger, with an index (median, ms)', ...each(result => result.area.jsonIndex.medianMsWithIndex));
out += row('Index needs a schema change', ...each(result => (result.area.jsonIndex.schemaChangeNeeded ? 'yes, a generated column' : 'no')));

out += '\n### Security\n\n' + header('Check', ...labels);
out += row('Official image starts without a password', ...dbs.map(db => (results.defaults[db].startsWithoutPassword ? '**yes**' : 'no')));
out += row('Message of the official image', ...dbs.map(db => (db === 'mongodb'
  ? (results.defaults.mongodb.anonymousAdminAccess ? `**anonymous client listed ${results.defaults.mongodb.databasesListedAnonymously.join(', ')}**` : 'none')
  : clean(results.defaults[db].message))));
out += row('Operator injection `{"$ne": ""}` in an email lookup returns a user', ...each(result => (result.area.operatorInjection.ok ? 'no' : '**yes**')));
out += row('Rows restricted to the current user by the database', ...each(result => (result.area.rowLevelSecurity.supported
  ? verdict(result.area.rowLevelSecurity.ok, `user 2 sees ${result.area.rowLevelSecurity.visibleToUser2} of ${result.area.rowLevelSecurity.totalRows} rows`)
  : 'not available')));

out += '\n### Footprint\n\n' + header('Measure', ...labels);
out += row('Docker image (MB)', ...each(result => result.footprint.imageMB));
out += row('Memory after the checks', ...each(result => result.footprint.memoryAfterChecks));

writeFileSync('results.md', out);
console.log(out);
