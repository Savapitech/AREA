Run of 2026-11-26 on commit ac75df2, AMD Ryzen 7 8700F 8-Core Processor, Node.js v24.21.0, PostgreSQL 17.

### Behavior

| Check | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| Workflow with 4 reactions saved and listed in order | yes, 1 workflow, nodes 1,2,3,4 | yes, 1 workflow, nodes 1,2,3,4 | yes, 1 workflow, nodes 1,2,3,4 | yes, 1 workflow, nodes 1,2,3,4 |
| Workflow whose third node is invalid leaves nothing | yes, rejected true, workflows left 1 | yes, rejected true, workflows left 1 | yes, rejected true, workflows left 1 | yes, rejected true, workflows left 1 |
| Workflow without a trigger refused by the database | yes, refused | yes, refused | yes, refused | yes, refused |
| Same occurrence recorded 100 times concurrently | yes, 1 of 100 accepted | yes, 1 of 100 accepted | yes, 1 of 100 accepted | yes, 1 of 100 accepted |
| 200 jobs claimed by 4 concurrent workers | yes, 200 claimed, 0 twice, split 48/50/52/50 | yes, 200 claimed, 0 twice, split 49/51/50/50 | yes, 200 claimed, 0 twice, split 51/51/49/49 | yes, 200 claimed, 0 twice, split 50/50/50/50 |
| Deleting a user removes its workflows, nodes and connections | yes, 0 workflows, 0 nodes, 0 connections left | yes, 0 workflows, 0 nodes, 0 connections left | yes, 0 workflows, 0 nodes, 0 connections left | yes, 0 workflows, 0 nodes, 0 connections left |

### Type checking

| Mistake | TypeORM | Prisma | Drizzle |
| --- | --- | --- | --- |
| Control file without mistake compiles | yes | yes | yes |
| Filter on a column that does not exist is refused | yes | yes | yes |
| Reading a field that was not selected is refused | **no** | yes | yes |
| Workflow config of the wrong shape is refused | yes | **no** | yes |

### Migrations

| Measure | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| ON DELETE CASCADE generated from the schema | yes | yes | yes | written by hand |
| CHECK on the workflow config generated from the schema | yes | **no** | yes | written by hand |
| Unique constraints generated from the schema | yes | yes | yes | written by hand |
| SQL files written by hand | 0 | 1 | 0 | 1 |
| Down migration generated | yes | **no** | **no** | **no** |
| Time to apply the migrations on an empty database (ms) | 50.2 | 906.8 | 32.8 | 16.1 |

### Performance (ms per operation, 1000 workflows of 5 reactions)

| Operation | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| Create a workflow and its nodes in a transaction | 2.242 | 2.897 | 2.1 | 1.868 |
| List the 20 workflows of a user with their nodes | 1.326 | 1.381 | 0.931 | 0.804 |
| Count the workflows by a JSON field | 0.452 | 0.648 | 0.415 | 0.365 |

### Dependencies

| Measure | TypeORM | Prisma | Drizzle | pg alone |
| --- | --- | --- | --- | --- |
| Production packages, driver included | 42 | 23 | 15 | 14 |
| Production size (MB) | 24.2 | 78 | 11 | 0.5 |
| Packages with the schema and migration tools | 42 | 153 | 103 | 14 |
| Size with the tools (MB) | 24.2 | 300.5 | 85.8 | 0.5 |
| Known vulnerabilities in production packages (npm audit) | none | none | none | none |
| Known vulnerabilities in the tools only (npm audit) | none | @prisma/config (high), effect (high), prisma (high) | @esbuild-kit/core-utils (moderate), @esbuild-kit/esm-loader (moderate), drizzle-kit (moderate), esbuild (moderate) | none |
