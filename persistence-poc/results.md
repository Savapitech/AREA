Run of 2026-11-26 on commit a33fe57, AMD Ryzen 7 8700F 8-Core Processor, Node.js v24.21.0.

### Operations on workflows (median of 5 runs, ms)

| Operation | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Insert 10 000 workflows, batches of 500 | 122.0 | 166.3 | 140.0 |
| 1 000 lookups by primary key | 283.8 | 254.4 | 392.5 |
| 1 000 updates by primary key | 1006.9 | 1005.2 | 2136.0 |
| 1 000 workflow lists of a user, with the user | 471.4 | 435.2 | 2056.6 |
| 20 counts filtered on a JSON field, no index | 21.8 | 102.3 | 46.6 |

### Integrity

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Rolled back transaction leaves nothing | yes | yes | yes |
| Workflow of a user that does not exist is refused | yes | yes | **no** |
| Workflow without a trigger is refused by the database | yes | yes | yes |
| Deleting a user deletes its workflows and service connections | yes | yes | **no**, 3 workflows and 1 connection left |

### Hooks and workers

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Same occurrence inserted 100 times by 20 connections, rows stored | yes, 1 row, 99 rejected | yes, 1 row, 99 rejected | yes, 1 row, 99 rejected |
| 200 jobs claimed by 4 concurrent workers, claimed twice | yes, 0, split 51/49/50/50, 113.3 ms | yes, 0, split 49/48/51/52, 126.6 ms | yes, 0, split 51/48/50/51, 154.7 ms |

### JSON index (100 000 workflows, 1 000 matching)

| Measure | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Count on the trigger, no index (median, ms) | 7.3 | 45.4 | 14.3 |
| Count on the trigger, with an index (median, ms) | 0.5 | 0.6 | 0.6 |
| Index needs a schema change | no | yes, a generated column | no |

### Security

| Check | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Official image starts without a password | no | no | **yes** |
| Message of the official image | Error: Database is uninitialized and superuser password is not specified. | Database is uninitialized and password option is not specified | **anonymous client listed admin, config, local** |
| Operator injection `{"$ne": ""}` in an email lookup returns a user | no | no | **yes** |
| Rows restricted to the current user by the database | yes, user 2 sees 1 of 3 rows | not available | not available |

### Footprint

| Measure | PostgreSQL 17 | MariaDB 11.4 | MongoDB 8 |
| --- | --- | --- | --- |
| Docker image (MB) | 665 | 451 | 1160 |
| Memory after the checks | 51.18MiB | 149.3MiB | 271MiB |
