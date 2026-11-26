# Persistence technology selection {#persistence_selection}

[TOC]

This document is the persistence technology selection asked by the Plan
milestone. It lists the technologies we considered, the criteria we evaluated
them against, security included, the comparison we performed and its results,
and the final choice with its justification. Every measured claim comes from
the proof of concept in `pocs/database/persistence-poc/` and can be reproduced with one
command (see @ref persistence_selection_evidence).

**Short answer.** AREA will store its data in **PostgreSQL 17**. Most of what
AREA stores is relational and owned by a user, and the parameters of each node
are JSON whose shape depends on the node type. PostgreSQL enforces the
relations, deletes what belongs to a user with the user, indexes JSON fields
without a schema change, isolates the rows of each user, and is the only
candidate that passed every integrity and security check. MariaDB is a close
second and MongoDB was rejected for this project.

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
is reduced, and the relations of section 1 would be written by hand.

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

## 6. Practical evidence {#persistence_selection_evidence}

Everything above can be reproduced from the repository. Docker and Node.js 24
are needed.

```sh
make persistence-bench    # or ./pocs/database/persistence-poc/run.sh
```

The command starts each database alone, runs `benchmark.js` and `checks.js`
against it, starts each official image without a password, and writes
`pocs/database/persistence-poc/results.json` and `pocs/database/persistence-poc/results.md`. It takes
about ten minutes. Numbers change slightly from one machine and one run to
another; the verdicts do not.

| Evidence | Where |
| -------- | ----- |
| Operations, rollback and foreign key checks | `pocs/database/persistence-poc/benchmark.js` |
| Integrity, concurrency, JSON index, security and image default checks | `pocs/database/persistence-poc/checks.js` |
| Database versions and setup | `pocs/database/persistence-poc/compose.yaml`, `pocs/database/persistence-poc/run.sh` |
| Results of the run quoted here | `pocs/database/persistence-poc/results.json`, `pocs/database/persistence-poc/results.md` |
| Search in the CISA catalog of exploited vulnerabilities | `tools/kev.mjs` |

## 7. Exploration by member

| Member | Persistence exploration |
| ------ | ----------------------- |
| Titouan | Benchmark of the three databases: data set, operations, rollback and foreign key checks, Docker Compose setup with the MongoDB replica set. |
| Savinien | Checks specific to AREA: deduplication, job sharing, user deletion, JSON index, validation, injection, row isolation, image defaults. Search in the catalog of exploited vulnerabilities and this document. |
| Enzo, Arthur | Front-end exploration, covered by the front-end technology selection. |

## 8. Sources

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
- [Prisma, MongoDB](https://www.prisma.io/docs/orm/overview/databases/mongodb)
