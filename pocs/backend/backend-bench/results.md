Run of 2026-11-26, AMD Ryzen 7 8700F 8-Core Processor, 16 threads, Node.js v24.21.0. Each POC runs alone, limited to 2 CPUs and 512 MB.

### Functional parity

| Check | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| Register | pass (201) | pass (201) | pass (201) |
| Register the same email | pass (409) | pass (409) | pass (409) |
| Register with an invalid body | pass (400) | pass (400) | pass (422) |
| Login with a wrong password | pass (401) | pass (401) | pass (401) |
| Login | pass (200) | pass (200) | pass (200) |
| Current user with the token | pass (200) | pass (200) | pass (200) |
| Current user without a token | pass (401) | pass (401) | pass (401) |
| Signed webhook | pass (200) | pass (200) | pass (200) |
| Same webhook again is flagged as a duplicate | pass (200) | pass (200) | pass (200) |
| Detected events without a token | pass (401) | pass (401) | pass (401) |
| Polling hook detected a timer.tick on its own | pass (200) | pass (200) | pass (200) |
| Seconds until the first timer.tick | 10 | 10 | 37.6 |

### Attacks

| Attack | Expected | NestJS | Express | Laravel |
| --- | --- | --- | --- | --- |
| JWT with "alg": "none" | 401 | protected: 401 | protected: 401 | protected: 401 |
| JWT signed with another secret | 401 | protected: 401 | protected: 401 | protected: 401 |
| JWT with a modified payload | 401 | protected: 401 | protected: 401 | protected: 401 |
| Expired JWT | 401 | protected: 401 | protected: 401 | protected: 401 |
| Valid JWT of a user that does not exist | 401 | protected: 401 | protected: 401 | protected: 401 |
| Mass assignment of id, isAdmin and passwordHash on register | rejected or ignored | protected: 400, request rejected | protected: 400, request rejected | protected: 201, extra fields ignored |
| SQL injection in the login email | 400 or 422 | protected: 400 | protected: 400 | protected: 422 |
| 1 MiB request body | 413, rejected before parsing | protected: 413 | **exposed**: 500 | **exposed**: 401 |
| Malformed JSON body | 4xx, no internals in the response | protected: 400 | protected: 400 | protected: 422 |
| Webhook without a signature | 401 | protected: 401 | protected: 401 | protected: 401 |
| Webhook signed with another secret | 401 | protected: 401 | protected: 401 | protected: 401 |
| Webhook body modified after signing | 401 | protected: 401 | protected: 401 | protected: 401 |
| Technology disclosed in response headers | no X-Powered-By | **exposed**: X-Powered-By: Express | **exposed**: X-Powered-By: Express | protected: Server: FrankenPHP Caddy |
| Account enumeration through login response time | same time for known and unknown emails | **exposed**: known 157.4 ms, unknown 2 ms | **exposed**: known 155.4 ms, unknown 1.8 ms | **exposed**: known 160.5 ms, unknown 12.8 ms |

### API description

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| OpenAPI version | 3.0.0 | 3.0.0 | 3.1.2 |
| Routes in the description | 5 / 5 | 5 / 5 | 5 / 5 |
| Request bodies with their fields described | 0 | 0 | 3 |
| Drift test: new route added in the code only, served | yes | yes | yes |
| Drift test: new route appears in the description | yes | no | yes |

### Performance and footprint

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| Start until the API answers (s) | 1 | 0.7 | 1 |
| GET /auth/me, requests per second (50 connections) | 3042 | 3657 | 240 |
| GET /auth/me, latency p50 / p99 (ms) | 15 / 23 | 13 / 17 | 206 / 248 |
| Failed requests | 0 | 0 | 0 |
| Processes to run | 1 | 1 | 2 |
| Docker image (MB) | 532 | 406 | 961 |
| Production dependencies | 180 | 126 | 82 |
| Known vulnerabilities (high or critical) | 0 (0) | 0 (0) | 0 (0) |
| Hand written code, files / non blank lines | 17 / 370 | 14 / 289 | 15 / 323 |
