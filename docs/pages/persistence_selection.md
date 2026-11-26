# Persistence technology selection {#persistence_selection}

[TOC]

This document is the persistence technology selection asked by the Plan
milestone. It lists the technologies we considered, the criteria we evaluated
them against, security included, the comparison we performed and its results,
and the final choice with its justification. Every measured claim comes from
the proofs of concept in `pocs/database/persistence-poc/` and
`pocs/database/orm-poc/`, and can be reproduced with one command each (see
@ref persistence_selection_evidence).

**Short answer.** AREA will store its data in **PostgreSQL 17**. Most of what
AREA stores is relational and owned by a user, and the parameters of each node
are JSON whose shape depends on the node type. PostgreSQL enforces the
relations, deletes what belongs to a user with the user, indexes JSON fields
without a schema change, isolates the rows of each user, and is the only
candidate that passed every integrity and security check. MariaDB is a close
second and MongoDB was rejected for this project. The server reaches it through
**TypeORM**, chosen in section 6.

## 1. What AREA stores

The subject describes the data of the product. This table lists it with the
needs it puts on the database, and the criterion of section 3 that covers each
need.

| Data | Shape | Need | Criterion |
| ---- | ----- | ---- | --------- |
| Users and local credentials | Fixed fields, one email per account | Unique constraint | Integrity |
| Links to external identities (OpenID Connect) | Several per user, one per provider and subject | Foreign key, unique pair | Integrity |
| Service connections and their delegated OAuth 2.0 credentials | One per user and Service, refreshed by the hooks | Foreign key, deletion with the user, protection of the secrets | Integrity, Security |
| Workflows | Owned by a user, enabled or not | Foreign key, deletion with the user, listing by user | Data model, Performance |
| Nodes of a workflow | A trigger, a linear chain of reactions, at most one condition with two branches, no structural maximum of reactions | Rows that reference their workflow and their predecessor, saved together | Integrity |
| Parameters of a node and values it publishes | Depends on the node type, keys declared by the type | JSON, checked when the workflow is saved, filtered by key | Data model |
| Occurrences seen by the hooks | One per detected event | The same occurrence must never start a workflow twice, even with concurrent hooks | Hooks and workers |
| Executions and their results | What a workflow did, shown by the mobile client | Appended often, linked to the workflow | Performance |

Most of this data is relational: it belongs to a user, it references other
rows, and it must disappear with its owner. Only the node parameters and the
event payloads are documents, and their shape is known per node type.

## 2. Technologies considered

Three databases were prototyped by the same benchmark, one from each family
that fits the data of section 1:

| Technology | Family | Prototyped |
| ---------- | ------ | ---------- |
| **PostgreSQL 17** | Relational, with a binary JSON type (`JSONB`) | Yes |
| MariaDB 11.4 | Relational, JSON stored as text | Yes |
| MongoDB 8 | Document store | Yes |

Other options were studied without a prototype, because a reason specific to
this project ruled them out first:

| Technology | Why it was not prototyped for this project |
| ---------- | ------------------------------------------ |
| MySQL 8 | Same family and SQL dialect as MariaDB, already covered by its prototype. It stores JSON in a binary format and has functional indexes, which would remove the generated column that MariaDB needs (section 4.2); the rest of the comparison would be the same. |
| SQLite | No network server and one writer at a time for the whole database, while the API and the hooks write concurrently. It remains an option for unit tests. |
| Redis | An in memory store, not a primary database for relational data owned by users. It may serve later as a queue or a cache. |
| Firebase, Supabase and other hosted databases | The product must build and run on its own with Docker Compose. Supabase is PostgreSQL underneath, so the choice below keeps that door open. |
| CockroachDB and distributed databases | The product does not need data spread over several servers, and they add operations that a single server does not. |

## 3. Criteria

The weights follow the needs of section 1. Integrity and security have the
highest weight: the database holds the delegated credentials of every user, and
a hook that treats the same event twice or a workflow left behind by a deleted
user are bugs the subject names explicitly.

| Criterion | Weight | How it is evaluated |
| --------- | -----: | ------------------- |
| Data model | 15 | How the relations and the JSON parameters of section 1 are stored and queried. |
| Integrity | 20 | What the database enforces by itself: transactions, foreign keys, validation of a workflow, deletion with the user. |
| Security | 20 | Defaults of the official image, injection through the query language, isolation of the rows of a user, encryption at rest, exploited vulnerabilities. |
| Hooks and workers | 15 | Deduplication of an occurrence under concurrent inserts, and sharing jobs between concurrent workers. |
| Performance | 10 | Time of the operations AREA performs most, on the same machine. |
| Access from NestJS | 10 | Support in the object relational mappers of the chosen back-end (see @ref backend_selection), migrations included. |
| Operations | 10 | What it takes to run it with Docker Compose: setup, image, memory. |

## 4. Comparison performed

### 4.1 Method

The benchmark in `pocs/database/persistence-poc/` starts each database alone with Docker
Compose, then runs two scripts against it:

- `benchmark.js` creates 100 users and 10 000 workflows whose `config` is JSON
  (`{"trigger": "github.push", "reaction": "discord.send_message"}`), then times
  the operations of section 4.6. Each measure is the median of 5 runs after a
  warm-up run. MongoDB runs as a replica set with majority and journaled
  writes, the only setup in which it supports transactions, so that its writes
  are as durable as those of the SQL databases.
- `checks.js` tests the properties of section 1 that AREA relies on, with
  concurrent connections where AREA will have them, and starts each official
  image without a password.

The results below come from the run of 2026-11-26 on commit `a33fe57`
(`pocs/database/persistence-poc/results.json`), on an AMD Ryzen 7 8700F, with PostgreSQL 17,
MariaDB 11.4 and MongoDB 8.

### 4.2 Data model

| Measure | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Relations between users, workflows and connections | Foreign keys and joins | Foreign keys and joins | References resolved by `$lookup`, not enforced |
| Storage of the node parameters | `JSONB`, binary | `JSON`, an alias of `LONGTEXT` checked by `JSON_VALID` | BSON documents |
| 20 counts filtered on a JSON field, 10 000 workflows, no index (ms) | 21.8 | 102.3 | 46.6 |
| Count on the trigger, 100 000 workflows, no index (median, ms) | 7.3 | 45.4 | 14.3 |
| Count on the trigger, 100 000 workflows, with an index (median, ms) | 0.5 | 0.6 | 0.6 |
| Index needs a schema change | no | yes, a generated column | no |

PostgreSQL stores JSON parsed, so it filters on a JSON field 4.7 times faster
than MariaDB, which parses the text of every row. With an index the three are
equal, but MariaDB can only index a JSON field through a generated column added
to the table, a schema change for every field that a query needs. MongoDB
stores the parameters naturally, but the rest of the data of section 1 is
relational: listing the workflows of a user with the user takes it 4 times
longer than the SQL databases (section 4.6).

### 4.3 Integrity

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Rolled back transaction leaves nothing | yes | yes | yes |
| Workflow of a user that does not exist is refused | yes | yes | **no** |
| Workflow without a trigger is refused by the database | yes | yes | yes |
| Deleting a user deletes its workflows and service connections | yes | yes | **no**, 3 workflows and 1 connection left |

The SQL databases refuse a workflow that points to a user that does not exist,
and `ON DELETE CASCADE` removes the workflows and the service connections of a
deleted user in the same statement. MongoDB has no foreign keys: the deleted
user left 3 workflows and a service connection, with its delegated
credentials, behind. Every deletion would have to be written and kept complete
by hand in the server. All three can refuse a workflow without a trigger:
a `CHECK` constraint on the JSON in SQL, a `$jsonSchema` validator in MongoDB.
The server still validates the structure of a workflow when it is saved, as the
subject requires; the database is a second barrier.

### 4.4 Hooks and workers

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Same occurrence inserted 100 times by 20 connections, rows stored | yes, 1 row, 99 rejected | yes, 1 row, 99 rejected | yes, 1 row, 99 rejected |
| 200 jobs claimed by 4 concurrent workers, claimed twice | yes, 0, split 51/49/50/50, 113.3 ms | yes, 0, split 49/48/51/52, 126.6 ms | yes, 0, split 51/48/50/51, 154.7 ms |

The three candidates meet both needs. A unique index on `(source, external id)`
lets exactly one of 100 concurrent inserts of the same occurrence succeed, which
is how a hook can never treat an event twice, even with several hook instances.
Jobs are shared between workers with `SELECT ... FOR UPDATE SKIP LOCKED` in SQL
and `findOneAndUpdate` in MongoDB, with no job claimed twice. This criterion
does not separate the candidates much.

### 4.5 Security

**Measured checks.**

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Official image starts without a password | no | no | **yes** |
| Message of the official image | Error: Database is uninitialized and superuser password is not specified. | Database is uninitialized and password option is not specified | **anonymous client listed admin, config, local** |
| Operator injection `{"$ne": ""}` in an email lookup returns a user | no | no | **yes** |
| Rows restricted to the current user by the database | yes, user 2 sees 1 of 3 rows | not available | not available |

- **Defaults.** The PostgreSQL and MariaDB images refuse to start without a
  password. The MongoDB image starts with authentication disabled, and an
  anonymous client from the network listed its administration databases. Its
  documentation says it: "By default Mongo's configuration requires no
  authentication for access, even for the administrative user." Campaigns have
  wiped tens of thousands of MongoDB databases left in this state and replaced
  them with ransom notes.
- **Injection.** With parameters, a SQL query compares the email with a value
  whatever its content. In MongoDB the query is itself a JSON document: a
  request body `{"email": {"$ne": ""}}` passed to `findOne` turned the lookup
  into "any email" and returned a user. The validation of the back-end would
  stop this input, but the database adds a class of injection that the SQL
  candidates do not have.
- **Row isolation.** PostgreSQL row level security let a role see only the
  workflows of user 2, even with a query that forgot the filter. It is a second
  barrier between the data of different users that the other two do not offer.
- **Encryption at rest.**

| | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 Community |
| --- | --- | --- | --- |
| Encryption of the data files by the server | No | Yes, with the file key management plugin | No, MongoDB Enterprise only |

No candidate decides this point for us: the delegated OAuth 2.0 credentials
will be encrypted by the server before they are stored, with a key kept outside
the database, so they are protected whatever the engine and in its backups too.

- **Exploited vulnerabilities.** In the CISA catalog of known exploited
  vulnerabilities, version 2026.11.25:

```sh
node tools/kev.mjs '^PostgreSQL' '^MariaDB' '^MongoDB$'
```

| Searched | Entries | Detail |
| -------- | ------: | ------ |
| PostgreSQL | 0 | |
| MariaDB | 0 | |
| MongoDB | 2 | CVE-2025-14847 ("MongoBleed", added 2025-12-29): an unauthenticated client reads server memory through the zlib compression of the protocol. CVE-2019-10758 in mongo-express, its administration interface. |

The three had serious flaws in 2026. The most severe ones published by
PostgreSQL (CVSS 8.8, CVE-2026-2005 and CVE-2026-2006) need an authenticated
database user, MariaDB fixed CVE-2026-32710 (CVSS 8.6), and MongoDB fixed
CVE-2026-118383 (CVSS 9.5), described as a pre-authentication flaw in the
replication. Whatever the engine, the database port will never be published
outside the Docker network of the product, and the server will connect with
its own role rather than the superuser.

### 4.6 Performance

| Operation (median of 5 runs, ms) | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Insert 10 000 workflows, batches of 500 | 122.0 | 166.3 | 140.0 |
| 1 000 lookups by primary key | 283.8 | 254.4 | 392.5 |
| 1 000 updates by primary key | 1006.9 | 1005.2 | 2136.0 |
| 1 000 workflow lists of a user, with the user | 471.4 | 435.2 | 2056.6 |
| 20 counts filtered on a JSON field, no index | 21.8 | 102.3 | 46.6 |

PostgreSQL and MariaDB are close on the relational operations: MariaDB is
about 10 percent faster on lookups and lists, they are equal on updates, and
PostgreSQL inserts in 27 percent less time and filters JSON 4.7 times faster. MongoDB, with durable writes, takes twice as long to
update and 4 times as long to list the workflows of a user with the user. The
queries run one after the other on one connection, so these numbers compare
the cost of each operation, not the capacity of a loaded server. At the scale
of this product, any of the three would be fast enough.

### 4.7 Access from NestJS

| | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| TypeORM, used by the back-end prototypes | Full support, relations and migrations | Full support, relations and migrations | "Basic MongoDB support", relations not documented |
| Prisma | Full support, Prisma Migrate | Full support, Prisma Migrate | Only with Prisma 6.19, not the current 7, and no Prisma Migrate |

Both object relational mappers that fit NestJS treat the SQL databases as
first class, with migrations generated from the entities. Their MongoDB support
is reduced, and the relations of section 1 would be written by hand. The
mapper itself is compared and chosen in section 6.

### 4.8 Operations

| Measure | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Docker image (MB) | 665 | 451 | 1160 |
| Memory after the checks | 51.18MiB | 149.3MiB | 271MiB |
| Setup for transactions | None | None | A replica set, initialized by a script after the start (`pocs/database/persistence-poc/run.sh`) |
| Backup tools | `pg_dump`, `pg_restore` | `mariadb-dump`, `mariadb-backup` | `mongodump`, `mongorestore` |
| License | PostgreSQL License | GPL version 2 | Server Side Public License |

## 5. Final choice

**Choice: PostgreSQL 17.**

| Criterion | Weight | PostgreSQL | MariaDB | MongoDB | Evidence |
| --------- | -----: | ---------: | ------: | ------: | -------- |
| Data model | 15 | 5 | 4 | 3 | Section 4.2: JSON storage and index |
| Integrity | 20 | 5 | 5 | 2 | Section 4.3 |
| Security | 20 | 5 | 4 | 2 | Section 4.5: defaults, injection, row isolation, catalog |
| Hooks and workers | 15 | 5 | 5 | 4 | Section 4.4 |
| Performance | 10 | 5 | 5 | 3 | Section 4.6 |
| Access from NestJS | 10 | 5 | 5 | 2 | Section 4.7 |
| Operations | 10 | 4 | 4 | 2 | Section 4.8 |
| **Weighted score out of 100** | | **98** | **91** | **51** | Sum of weight times score, divided by 5 |

PostgreSQL passed every integrity and security check, stores the relational
data of section 1 with foreign keys and cascading deletion, and the node
parameters as indexed JSON without a schema change. It is the only candidate
that can isolate the rows of each user, and it has no entry in the catalog of
exploited vulnerabilities.

**Why not MariaDB.** MariaDB passed the same integrity and concurrency checks
and is as fast on the relational operations. For this project it loses on
JSON, which every node of every workflow uses: it filters JSON 4.7 times slower,
it needs a generated column for each JSON field that a query uses, and it
cannot isolate the rows of a user. It encrypts its data files, which PostgreSQL
does not, but the credentials will be encrypted by the server in any case.

**Why not MongoDB.** The documents of MongoDB fit the node parameters, but most
of AREA is relational. It does not enforce the relations, so a deleted user
left its workflows and its delegated credentials behind. Its official image
starts without authentication, its query language adds operator injection, it
had a vulnerability exploited in the wild in 2025, it needs a replica set for
transactions, and the mappers of NestJS support it partially.

**Accepted drawbacks.**

- The community server does not encrypt its data files. The credentials are
  encrypted by the server, and the volumes can be encrypted by the host.
- MariaDB is about 10 percent faster on lookups by key and on lists.
- Row level security does not apply to the owner of the tables or to a
  superuser: it only protects if the server connects with a dedicated role.
- `JSONB` accepts any shape, so the keys of the node parameters must be checked
  when a workflow is saved, as the subject requires anyway.

**Carried to the MVP from this study.**

- A unique constraint on the source and the identifier of each occurrence seen
  by a hook.
- Foreign keys with `ON DELETE CASCADE` for everything a user owns.
- A dedicated database role for the server, not the superuser, and no
  published database port outside the Docker network.
- Encryption of the delegated credentials by the server before storage.
- Migrations instead of the `synchronize` option of the prototypes.
- `SELECT ... FOR UPDATE SKIP LOCKED` if the hooks are shared between workers.

## 6. Object relational mapper {#persistence_selection_orm}

The server does not write SQL by hand for every query: an object relational
mapper (ORM) maps the tables to TypeScript types, runs the queries and
generates the migrations from the schema. It is part of the persistence
choice, so it went through the same method, with its own proof of concept in
`pocs/database/orm-poc/`.

**Short answer.** The server will use **TypeORM 1.1**. It is the only mapper
that generated the whole schema of AREA from the entities, constraints and
down migrations included, it is integrated into NestJS by the NestJS team since
2017, it has been stable for ten years, and both back-end prototypes already use
it. Drizzle measured better on typing, speed and size, and was rejected for this
project because its stable line is still 0.x while its 1.0 has been in beta for
twenty months.

### 6.1 Technologies considered

| Technology | Approach | Prototyped |
| ---------- | -------- | ---------- |
| **TypeORM 1.1** | Entities are classes with decorators, repositories and a query builder | Yes |
| Prisma 7.10 | A schema file from which a client is generated | Yes |
| Drizzle 0.45 | The schema is TypeScript, queries are written close to SQL | Yes |
| `pg` alone | No mapper, hand written SQL, used as the control | Yes |

| Technology | Why it was not prototyped for this project |
| ---------- | ------------------------------------------ |
| MikroORM | Same design as TypeORM (decorators, entities, unit of work), so it would answer the same question with a smaller community. |
| Kysely | A typed query builder only: the schema and the migrations would be written by hand, like with `pg` alone. |
| Sequelize | Its types are added on top of a JavaScript API, while typing is one of our criteria. |

### 6.2 Criteria

| Criterion | Weight | How it is evaluated |
| --------- | -----: | ------------------- |
| Migrations | 20 | What the tool generates from the schema: cascades, `CHECK`, unique constraints, and the down migration that undoes a deployment. |
| Typing | 15 | Three deliberate mistakes that the TypeScript compiler should refuse. |
| Integration with NestJS | 15 | Who maintains the integration, since when, and how much it is used. |
| Maturity | 15 | Age, stable version, and how close a breaking major version is. |
| Experience of the group | 10 | What the members already wrote with it. |
| Needs of the hooks | 10 | Native API for the deduplication of an occurrence and for `FOR UPDATE SKIP LOCKED`. |
| Dependencies and security | 10 | Packages and size in production and with the tools, known vulnerabilities. |
| Performance | 5 | Time per operation against `pg` alone. |

### 6.3 Comparison performed

The four implementations follow the same interface (`src/store.ts`) on the
same schema: users, workflows, nodes, service connections, hook occurrences and
jobs, with the cascades, the unique constraints and the `CHECK` of section 4.3.
Each tool generated its own migrations from its own schema (`src/typeorm/migrations/`,
`prisma/migrations/`, `drizzle/`), and the benchmark applies them to an empty
PostgreSQL 17 database before running the same checks, the same type mistakes
and the same workload. The results below come from the run of 2026-11-26 on
commit `ac75df2` (`pocs/database/orm-poc/results.json`).

**Behavior.** The four implementations pass the same six checks: a workflow
with four reactions saved and listed in order, a workflow whose third node is
invalid leaves nothing, a workflow without a trigger is refused, one of 100
concurrent inserts of the same occurrence is accepted, 200 jobs are shared by 4
workers without one claimed twice, and deleting a user removes its workflows,
nodes and connections. The mapper does not weaken any guarantee of section 4.

**Migrations.**

| Measure | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| ON DELETE CASCADE generated from the schema | yes | yes | yes | written by hand |
| CHECK on the workflow config generated from the schema | yes | **no** | yes | written by hand |
| Unique constraints generated from the schema | yes | yes | yes | written by hand |
| SQL files written by hand | 0 | 1 | 0 | 1 |
| Down migration generated | yes | **no** | **no** | **no** |

TypeORM is the only tool that generated everything, including a `down` method
that undoes the migration. Prisma cannot describe a `CHECK` constraint in its
schema: we wrote it in a second migration by hand. Neither Prisma nor Drizzle
generates down migrations, so undoing a deployment would mean writing the
reverse SQL under pressure.

**Typing.** Each file of `typecheck/` contains one mistake and is compiled
with `tsc`; a control file without the mistake must compile, which shows that
the refusal comes from the mistake.

| Mistake | TypeORM | Prisma | Drizzle |
| --- | --- | --- | --- |
| Control file without mistake compiles | yes | yes | yes |
| Filter on a column that does not exist is refused | yes | yes | yes |
| Reading a field that was not selected is refused | **no** | yes | yes |
| Workflow config of the wrong shape is refused | yes | **no** | yes |

Drizzle refused all three. TypeORM types the result of a partial `select` as
the whole entity, so a field that was not loaded reads as `undefined` at run
time. Prisma types every JSON column as any JSON value, so it accepted a
trigger written as a number.

**Needs of the hooks.** The three mappers have a native API to insert an
occurrence only if it is new (`orIgnore`, `skipDuplicates`,
`onConflictDoNothing`). TypeORM and Drizzle express `FOR UPDATE SKIP LOCKED`
natively, Prisma needs raw SQL. The first run of the benchmark found a trap in
TypeORM: `getOne()` does not add a `LIMIT`, it loads every matching row and
returns the first one (`getOne` in `typeorm/query-builder/SelectQueryBuilder.js`). With `FOR UPDATE SKIP LOCKED`, the first worker locked
all the free jobs and the three others found nothing: the 200 jobs were split
200, 0, 0 and 0. Adding `.limit(1)` gave the split of the table above (48, 50,
52, 50). We also found that TypeORM runs `CREATE EXTENSION IF NOT EXISTS
"uuid-ossp"` when it connects, which needs a superuser, unless the
`installExtensions` option is turned off.

**Maturity and integration.** Measured on npm on 2026-11-27.

| | TypeORM | Prisma | Drizzle |
| --- | --- | --- | --- |
| First release | 2016 | 2020 (current client) | 2021 |
| Current stable version | 1.1.3, the 1.0 was released on 2026-05-19 | 7.10.1 | 0.45.4 |
| Next major version | No 2.x version published | | 1.0, in beta since 2025-03-13, 22 betas so far |
| Integration with NestJS | `@nestjs/typeorm`, by the NestJS team since 2017, 4.7 million weekly downloads | No package, a recipe in the NestJS documentation | `@nestjs/drizzle`, by the NestJS team since 2026-09-23, version 0.0.2, 33 thousand weekly downloads |
| Weekly downloads, 19 to 25 November 2026 | 7.3 million | 23.7 million | 47.8 million |

Drizzle is the most downloaded of the three, so its community is not the
problem. Its stable API is: it is still 0.x, and the 1.0 that will replace it
has been in beta for twenty months. Adopting it now means either running a beta
in production or migrating to a new major version during the project. Its
NestJS integration is two months old.

**Experience of the group.** Both back-end prototypes were written with
TypeORM: the NestJS one through `TypeOrmModule.forRootAsync`,
`TypeOrmModule.forFeature` and `@InjectRepository`
(`pocs/backend/nestJs-poc/`), the Express one with a `DataSource`
(`pocs/backend/express-poc/`). The two members who write the server have used
it, and the group has more experience with TypeORM than with Prisma or
Drizzle.

**Performance.**

| Operation (ms per operation, 1000 workflows of 5 reactions) | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| Create a workflow and its nodes in a transaction | 2.242 | 2.897 | 2.1 | 1.868 |
| List the 20 workflows of a user with their nodes | 1.326 | 1.381 | 0.931 | 0.804 |
| Count the workflows by a JSON field | 0.452 | 0.648 | 0.415 | 0.365 |

Drizzle stays closest to `pg` alone. TypeORM lists the workflows of a user in
1.3 ms against 0.9 ms for Drizzle. The difference is real but well below what
a user of the product could notice.

**Dependencies and security.**

| Measure | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| Production packages, driver included | 42 | 23 | 15 | 14 |
| Production size (MB) | 24.2 | 78 | 11 | 0.5 |
| Packages with the schema and migration tools | 42 | 153 | 103 | 14 |
| Size with the tools (MB) | 24.2 | 300.5 | 85.8 | 0.5 |
| Known vulnerabilities in production packages (npm audit) | none | none | none | none |
| Known vulnerabilities in the tools only (npm audit) | none | `@prisma/config` (high), `effect` (high), `prisma` (high) | `@esbuild-kit/core-utils` (moderate), `@esbuild-kit/esm-loader` (moderate), `drizzle-kit` (moderate), `esbuild` (moderate) | none |

TypeORM has no separate tool: the migrations are generated and applied by the
package that runs in production. The Prisma command line, which applies the
migrations at deployment, carries a high severity vulnerability
(GHSA-7589-6fvf-x4pw, a regular expression denial of service in `effect`).
The vulnerability of `drizzle-kit` is in the development server of esbuild
(GHSA-67mh-4wv8-2f99), which we would not run. None of the three appears in the
CISA catalog of exploited vulnerabilities (`node tools/kev.mjs TypeORM Prisma Drizzle`).

### 6.4 Final choice

**Choice: TypeORM.**

| Criterion | Weight | TypeORM | Prisma | Drizzle | Evidence |
| --------- | -----: | ------: | -----: | ------: | -------- |
| Migrations | 20 | 5 | 2 | 4 | Generated SQL and down migrations |
| Typing | 15 | 3 | 3 | 5 | Type mistakes |
| Integration with NestJS | 15 | 5 | 3 | 2 | Maturity and integration |
| Maturity | 15 | 5 | 4 | 2 | Maturity and integration |
| Experience of the group | 10 | 5 | 2 | 2 | Back-end prototypes |
| Needs of the hooks | 10 | 4 | 3 | 5 | Native APIs, `getOne()` trap |
| Dependencies and security | 10 | 4 | 2 | 4 | Packages, size, audit |
| Performance | 5 | 3 | 3 | 5 | Time per operation |
| **Weighted score out of 100** | | **88** | **55** | **70** | Sum of weight times score, divided by 5 |

TypeORM is the mapper we can rely on for the length of the project. It turns
the entities into complete migrations, the `CHECK` of a workflow and the down
migration included, so the schema lives in one place and a failed deployment
can be undone. It is the mapper that NestJS integrates first: its repositories
are injected like any other provider, which is the structure that made us
choose NestJS (see @ref backend_selection). Its 1.0 is stable, and the two
members who write the server already used it in both prototypes.

**Why not Drizzle.** Drizzle refused every type mistake, stayed closest to
`pg` alone and has the smallest footprint: on those three points it is better
than TypeORM, and we say it. For this project it loses on what lasts: its
stable version is 0.x and its 1.0 has been in beta since March 2025, its NestJS
integration is version 0.0.2, it does not generate down migrations, and the
group has less experience with it. If Drizzle 1.0 is released as stable before the MVP,
this choice is worth reviewing with the same benchmark.

**Why not Prisma.** It cannot generate the `CHECK` constraint of a workflow,
it types the node parameters as any JSON value, it needs raw SQL for the
workers, its tools weigh 300 MB with a high severity vulnerability in the
command line used at deployment, and it was the slowest of the three.

**Accepted drawbacks, and how we handle them.**

- A partial `select` is typed as the whole entity: the server does not return
  partially loaded entities, it maps them to response DTOs.
- `getOne()` with a lock locks every matching row: every locking query takes
  `.limit(1)`, and the benchmark keeps the check with 4 concurrent workers.
- TypeORM installs `uuid-ossp` when it connects: the server sets
  `installExtensions: false` and `uuidExtension: 'pgcrypto'`, so that it can
  run with the dedicated role of section 5 (`gen_random_uuid()` is built into
  PostgreSQL since version 13).
- The query builder takes SQL fragments as strings, such as the JSON filter on
  the trigger: values are always passed as named parameters, never written
  into the string.
- Lists are about 40 percent slower than with Drizzle, which is accepted at the
  scale of this product.

## 7. Practical evidence {#persistence_selection_evidence}

Everything above can be reproduced from the repository. Docker and Node.js 24
are needed.

```sh
make persistence-bench    # or ./pocs/database/persistence-poc/run.sh
make orm-bench            # or ./pocs/database/orm-poc/run.sh
```

The first command starts each database alone, runs `benchmark.js` and
`checks.js` against it, starts each official image without a password, and
writes `pocs/database/persistence-poc/results.json` and
`pocs/database/persistence-poc/results.md`. It takes about ten minutes. The
second one applies the migrations of each mapper to an empty PostgreSQL
database, runs the same checks, type mistakes and workload, and writes
`pocs/database/orm-poc/results.json` and `pocs/database/orm-poc/results.md` in
about a minute. Numbers change slightly from one machine and one run to
another; the verdicts do not.

| Evidence | Where |
| -------- | ----- |
| Operations, rollback and foreign key checks | `pocs/database/persistence-poc/benchmark.js` |
| Integrity, concurrency, JSON index, security and image default checks | `pocs/database/persistence-poc/checks.js` |
| Database versions and setup | `pocs/database/persistence-poc/compose.yaml`, `pocs/database/persistence-poc/run.sh` |
| Results of the run quoted here | `pocs/database/persistence-poc/results.json`, `pocs/database/persistence-poc/results.md` |
| Common interface and implementation of each mapper | `pocs/database/orm-poc/src/` |
| Schemas and migrations generated by each mapper | `pocs/database/orm-poc/src/typeorm/`, `pocs/database/orm-poc/prisma/`, `pocs/database/orm-poc/drizzle/` |
| Type mistakes | `pocs/database/orm-poc/typecheck/` |
| Benchmark of the mappers and its results | `pocs/database/orm-poc/src/bench.ts`, `pocs/database/orm-poc/results.json`, `pocs/database/orm-poc/results.md` |
| Search in the CISA catalog of exploited vulnerabilities | `tools/kev.mjs` |

## 8. Exploration by member

| Member | Persistence exploration |
| ------ | ----------------------- |
| Titouan | Benchmark of the three databases: data set, operations, rollback and foreign key checks, Docker Compose setup with the MongoDB replica set. First use of TypeORM in the NestJS prototype. |
| Savinien | Checks specific to AREA: deduplication, job sharing, user deletion, JSON index, validation, injection, row isolation, image defaults. Comparison of the object relational mappers. Search in the catalog of exploited vulnerabilities and this document. |
| Enzo, Arthur | Front-end exploration, covered by the front-end technology selection. |

## 9. Sources

- [CISA, Known Exploited Vulnerabilities catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- [PostgreSQL security information](https://www.postgresql.org/support/security/)
- [MongoDB security alerts](https://www.mongodb.com/resources/products/alerts)
- [MariaDB Community Server CVEs](https://mariadb.com/docs/server/security/cve/community-server)
- [Unit 42, MongoBleed (CVE-2025-14847)](https://unit42.paloaltonetworks.com/mongobleed-cve-2025-14847/)
- [Dark Reading, 22,900 MongoDB databases affected in ransomware attack](https://www.darkreading.com/cloud/22900-mongodb-databases-affected-in-ransomware-attack/d/d-id/1338271)
- [Docker Hub, official MongoDB image](https://hub.docker.com/_/mongo)
- [MongoDB, encryption at rest](https://www.mongodb.com/docs/manual/core/security-encryption-at-rest/)
- [MariaDB, data at rest encryption](https://mariadb.com/docs/server/security/encryption/data-at-rest-encryption/data-at-rest-encryption-tde-fundamentals)
- [PostgreSQL, row security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [TypeORM, MongoDB](https://typeorm.io/docs/drivers/mongodb/)
- [TypeORM, migrations](https://typeorm.io/docs/advanced-topics/migrations/)
- [NestJS, database with TypeORM](https://docs.nestjs.com/techniques/database)
- [NestJS, Prisma recipe](https://docs.nestjs.com/recipes/prisma)
- [Prisma, unsupported database features such as CHECK constraints](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features)
- [Drizzle ORM releases](https://github.com/drizzle-team/drizzle-orm/releases)
- [GHSA-7589-6fvf-x4pw, ReDoS in effect](https://github.com/advisories/GHSA-7589-6fvf-x4pw)
- [GHSA-67mh-4wv8-2f99, esbuild development server](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
- [Prisma, MongoDB](https://www.prisma.io/docs/orm/overview/databases/mongodb)
