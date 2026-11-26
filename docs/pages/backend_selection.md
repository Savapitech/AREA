# Back-end technology selection {#backend_selection}

[TOC]

This document is the back-end technology selection asked by the Plan milestone.
It lists the technologies we considered, the criteria we evaluated them
against, security included, the comparison we performed and its results, and
the final choice with its justification. Every measured claim comes from a
proof of concept committed in the repository and can be reproduced with one
command (see @ref backend_selection_evidence).

**Short answer.** The application server will use **NestJS** on Node.js 24,
in TypeScript. It generates the OpenAPI description that the clients rely on
from the code, it structures the server into modules with dependency injection
so the members can work in parallel and the business logic stays behind
abstractions, it runs the hooks inside the server process, and it blocked the
largest number of attacks in our test suite. Express alone and Laravel were
prototyped with the same scope and rejected for this project, for the reasons
measured below.

## 1. What the back-end has to do

The subject gives the application server most of the product. These are the
requirements that a back-end technology can make easier or harder, and the
criterion of section 3 that covers each of them.

| Requirement of the subject | Criterion |
| -------------------------- | --------- |
| The server serves an OpenAPI description of its HTTP API with a browsable interface. It is the contract between the clients and the server, built in parallel by different members, and a test fails when the implementation and the description disagree. | API contract |
| Business logic and rules belong to the server and are isolated behind abstractions. | Structure |
| Full-stack frameworks are strongly discouraged, because a single code base blurs the boundary between the clients and the server. | Separation |
| Hooks detect Actions and start workflows without a client being open, and must not treat the same occurrence as a new event indefinitely. | Hooks |
| Security is part of every technology selection, and the authentication, the hooks and the stored credentials are the exposed surface of the product. | Security |
| Local authentication, authentication through an OpenID Connect provider, and OAuth 2.0 delegated access to each Service. | Delegated authentication |
| The complete product is reproducibly buildable and runnable with Docker Compose. | Deployment |
| The web client is written in React and TypeScript by other members of the group. | Shared language |
| The server answers both clients and runs the hooks continuously. | Performance |

## 2. Technologies considered

Three technologies were prototyped with exactly the same scope (section 4.1).
They were chosen to answer two different questions:

- **NestJS against Express alone.** NestJS is a framework built on top of
  Express. Comparing them with the same language, the same ORM (TypeORM) and the
  same database isolates one question: is the structure that NestJS adds worth
  its cost?
- **NestJS against Laravel.** Laravel is a complete framework from another
  ecosystem, with a different language, a different runtime and a different way
  of serving requests. It answers the question: is a framework outside Node.js
  a better fit?

| Technology | Language and runtime | Prototyped | Folder |
| ---------- | -------------------- | ---------- | ------ |
| **NestJS 12** | TypeScript, Node.js 24 | Yes | `pocs/backend/nestJs-poc/` |
| Express 5 alone | TypeScript, Node.js 24 | Yes | `pocs/backend/express-poc/` |
| Laravel 13 | PHP 8.5, FrankenPHP | Yes | `pocs/backend/laravel-poc/` |

Other options were studied without a prototype, because a reason specific to
this project ruled them out first:

| Technology | Why it was not prototyped for this project |
| ---------- | ------------------------------------------ |
| Fastify | NestJS can run on Fastify through its platform adapter, so it is a later performance option inside the chosen framework rather than a separate choice. |
| AdonisJS | A TypeScript framework close to Laravel, including server rendered views. It would raise the same separation question as Laravel with a smaller ecosystem. |
| FastAPI (Python) | Its generated OpenAPI is excellent, but it adds a second language next to the TypeScript of the web client, and its scheduling and background work rely on separate tools such as Celery. |
| Spring Boot (Java) | A strong and structured framework, close to NestJS in its design, but it adds a second language and its weight is not needed by the size of this product. |
| Go with Gin or Echo | Its performance is not a need of this product (section 4.10), and the OpenAPI description is written in comments, which is the drift problem measured on Express in section 4.3. |

## 3. Criteria

The weight of each criterion follows the importance the subject gives to the
requirement behind it. Security has the highest weight because the subject
asks for it explicitly in this deliverable, and because the server holds the
credentials that let the product act on behalf of the users.

| Criterion | Weight | How it is evaluated |
| --------- | -----: | ------------------- |
| API contract | 15 | Is the OpenAPI description produced from the code, and does it follow a change made in the code only (drift test)? |
| Structure | 15 | How the code is split into units with explicit dependencies, and what the framework enforces rather than leaves to conventions. |
| Separation | 5 | Is the technology an API server, or a full-stack framework used as one? |
| Hooks | 15 | Can a polling hook run without a client, how many processes it needs, how fast it starts detecting, and how duplicates are rejected. |
| Security | 20 | A suite of 14 attacks run against each prototype, the exposure of the runtime itself, and the audit of the dependencies. |
| Delegated authentication | 10 | Maintained libraries for OpenID Connect and OAuth 2.0. Not prototyped at this milestone. |
| Deployment | 10 | What it takes to build and run the prototype with Docker Compose: processes, configuration, image size. |
| Shared language | 5 | Is it the language of the React web client? |
| Performance | 5 | Requests per second and latency on an authenticated route, under the same resource limits. |

## 4. Comparison performed

### 4.1 Method

Each prototype implements the same scope, with the same routes and the same
behavior:

| Feature | Routes |
| ------- | ------ |
| Local account with a hashed password | `POST /auth/register` |
| Login returning a JWT valid one hour | `POST /auth/login` |
| Route protected by the JWT, the user is reloaded from the database | `GET /auth/me` |
| Webhook signed with an HMAC-SHA256 of the raw body, deduplicated by event identifier | `POST /hooks/webhook` |
| Polling hook: a `timer.tick` checked every 10 seconds, one occurrence per minute, deduplicated by a unique `(source, external id)` constraint | runs on its own |
| List of the detected events, protected by the JWT | `GET /hooks/events` |
| OpenAPI description and browsable interface | `GET /docs/openapi.json`, `GET /docs` |

The benchmark in `pocs/backend/backend-bench/` builds a Docker image of each prototype and
runs them one at a time against the same PostgreSQL 17 server, each limited to
2 CPUs and 512 MB, with secrets generated for the run. Laravel is served by
FrankenPHP, a production server, rather than by the development server of
`php artisan serve`. For each prototype the benchmark measures the start time,
replays the functional scenario, runs the attack suite, measures the login
response times and the throughput, applies the drift patch, and counts the
code and the dependencies. The results below come from the run of 2026-11-26
on commit `33fd44d` (`pocs/backend/backend-bench/results.json`), on an AMD Ryzen 7 8700F.

### 4.2 Functional parity

All three prototypes pass the same 11 checks, which is what makes the rest of
the comparison fair: the differences below do not come from a missing feature.

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

### 4.3 API contract

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| OpenAPI version | 3.0.0 | 3.0.0 | 3.1.2 |
| Routes in the description | 5 / 5 | 5 / 5 | 5 / 5 |
| Request bodies with their fields described | 0 | 0 | 3 |
| Drift test: new route added in the code only, served | yes | yes | yes |
| Drift test: new route appears in the description | yes | no | yes |

The drift test adds a `GET /hooks/drift` route to the code of each prototype
and nothing else (`pocs/backend/backend-bench/drift/`). It shows the risk the subject wants a
test to catch: with Express, the route is served but missing from the
description, because the description is a second, hand written copy of the
routes (`pocs/backend/express-poc/src/openapi.ts`). With NestJS, `@nestjs/swagger` reads the
controllers. With Laravel, Scramble reads the routes.

Laravel is ahead on one point and we say it: Scramble infers the request
bodies from the validation rules and the responses from the controllers,
without any annotation. Our NestJS prototype documents routes only, because the
field details need either `@ApiProperty` decorators or the `@nestjs/swagger`
compiler plugin, which reads the DTO classes. The plugin was not enabled in the
prototype. Scramble also refuses to serve the documentation outside the local
environment unless a gate allows it, a good default.

### 4.4 Structure

| | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| Unit of code | Module that declares its controllers, providers, imports and exports | File that exports a router or a function | Controller, service provider, middleware |
| Dependencies | Injected through constructors, resolved by the container | Imported module singletons (`pocs/backend/express-poc/src/data-source.ts`) | Injected by the service container |
| Protecting a route | Guard class, reused by another module through its exports (`JwtAuthGuard` in `HooksModule`) | Middleware function, the user is attached with a cast | Middleware alias |
| Validation | Declared on the DTO class, applied by a global pipe | Our own middleware around zod (`pocs/backend/express-poc/src/middleware/validate.ts`) | Rules in the controller |
| Error format | Built-in exceptions with a uniform body | Our own error handler, applied by convention (`pocs/backend/express-poc/src/errors.ts`) | Built-in exception handler |
| Hand written code, files / non blank lines | 17 / 370 | 14 / 289 | 15 / 323 |

NestJS needs more code than Express for the same scope (370 lines against 289):
modules, decorators and DTO classes are lines too. Its value is not in writing
less, it is in what it enforces. The error handler of Express shows the
difference: we wrote it by hand, and the attack suite found a case it does not
cover (a 1 MiB body answered with a 500, section 4.6), while NestJS answered
413 without any code of ours. Two members write the server while the two others
write the web client against its description, and the server will grow with one
module per Service. A structure that the framework imposes is cheaper than one
that each member must remember.

### 4.5 Hooks

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| Mechanism | `@Interval` from `@nestjs/schedule`, in the server process | `setInterval`, with our own error handling and shutdown | Laravel scheduler, `everyTenSeconds()` |
| Processes to run | 1 | 1 | 2 (`frankenphp` and `php artisan schedule:work`) |
| Seconds until the first `timer.tick` after start | 10 | 10 | 37.6 |
| Deduplication | Unique constraint | Unique constraint | Unique constraint |

A PHP request lives only as long as the request it answers, so a PHP server
cannot keep a timer. Laravel needs a second, long running process for its
scheduler, which starts its sub-minute tasks at the next minute boundary: the
first detection came 37.6 seconds after the start in this run, and can take
up to a minute. NestJS runs the hooks in the same process as the API, and its
scheduler is a module like any other, with access to the same injected
services.

### 4.6 Security

**Attack suite.** The same 14 attacks were run against each prototype
(`pocs/backend/backend-bench/bench.mjs`, function `security`).

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

What the results say:

- **NestJS blocked 12 attacks out of 14, Express and Laravel 11.** The JWT and
  webhook checks hold in all three, because the logic is the same.
- **Request size.** NestJS and Express refuse bodies above 100 KB before
  parsing them, but our Express error handler turns that refusal into a 500.
  PHP accepts bodies up to `post_max_size` (8 MB by default) and Laravel parsed
  the 1 MiB body and ran the login.
- **Mass assignment.** NestJS and our Express code reject unknown fields.
  Laravel ignores them, which is safe as long as every controller uses the
  validated data only.
- **Headers.** The Laravel result is not a default: the PHP image sent
  `X-Powered-By: PHP/8.5.13` until we set `expose_php = Off` in
  `pocs/backend/laravel-poc/Dockerfile`. Both Node.js prototypes send `X-Powered-By: Express`,
  which `app.disable('x-powered-by')` removes.
- **Account enumeration.** The three prototypes answer an unknown email about
  150 ms faster than a known one, because they skip the password hash. An
  attacker can tell which emails have an account. The fix does not depend on the
  framework (always compare against a hash) and is carried to the MVP.

**Exposure of the runtime.** A Node.js server is one process that parses HTTP
itself. A PHP application needs a server API between the web server and the
interpreter (`mod_php`, PHP-FPM, `php-cgi`, FrankenPHP), which is a layer to
choose, configure and patch. The vulnerabilities of 2026 that matter most are in
that layer:

- In October 2026, CVE-2026-109618 and CVE-2026-109619 ("php2shell", CVSS 9.2)
  allowed remote code execution without authentication on all PHP
  installations serving web requests, FrankenPHP and PHP-FPM included. CISA
  added both to its catalog of known exploited vulnerabilities on 26 October
  2026, and the PHP advisory states that updating is the only complete
  mitigation.
- In November 2026, CVE-2026-129289 (CVSS 9.2) allowed code execution through
  PHP-FPM, only on servers that reuse their FastCGI connections, which is not
  the default of nginx and Apache.
- In 2024, CVE-2024-4577 in `php-cgi` on Windows was used by a ransomware group
  two days after the fix was published.
- A leaked Laravel `APP_KEY` turns into remote code execution, because
  `decrypt()` deserializes its input. GitGuardian and Synacktiv found hundreds
  of applications exposed this way in 2025.

The catalog of known exploited vulnerabilities of CISA lists the flaws that
attackers really used. In its version 2026.11.25 (1805 entries), this command
finds:

```sh
node tools/kev.mjs '^PHP' '^Laravel$' 'Node\.?js' '^Express\b' 'NestJS' 'TypeORM'
```

| Searched | Entries | Most recent |
| -------- | ------: | ----------- |
| PHP, its interpreter, FPM and CGI included | 8 | CVE-2026-109618 and CVE-2026-109619, added on 2026-10-26 |
| Laravel, its framework and packages | 3 | CVE-2025-54068 in Livewire, added on 2026-03-20; CVE-2018-15133 is the `APP_KEY` deserialization of the framework |
| Node.js | 1 | CVE-2021-21315, in an npm package (systeminformation), not in Node.js itself |
| Express, NestJS, TypeORM | 0 | |

An empty line does not mean that a project has no vulnerability, only that
none was reported as exploited.

Node.js is not free of vulnerabilities: its October 2026 release fixed 10 of
them, the most severe rated High, including a Brotli out-of-bounds write
(CVE-2026-111497) that was the same library bug as one PHP fixed in its Windows
builds. The October advisory does not report any exploitation.
This is not a verdict on PHP in general. For this project, it means that
Laravel adds a component that we would have to configure and patch on our own,
and that this component carried the most severe flaws of the year. The image of
our prototype uses PHP 8.5.13, which fixes all of the above.

**Dependencies.** `npm audit` and `composer audit` reported no known
vulnerability in the production dependencies of any prototype. NestJS has the
most production packages (180, against 126 for Express and 82 for Laravel),
which is a larger surface to follow. The dependency scan will run in the
continuous integration.

### 4.7 Delegated authentication

Not prototyped at this milestone. NestJS and Express both use Passport
(`@nestjs/passport` wraps it) and `openid-client` for OpenID Connect, so they
are equal on this point. Laravel has Socialite, a first-party OAuth 2.0 client
with many providers, and is slightly ahead.

### 4.8 Deployment

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| Processes to run | 1 | 1 | 2 |
| Runtime configuration in the Dockerfile | None | None | `pdo_pgsql` and `zip` extensions, production `php.ini`, `expose_php = Off`, choice of the server mode |
| Docker image (MB) | 532 | 406 | 961 |
| Start until the API answers (s) | 1 | 0.7 | 1 |

The first build of the Laravel image failed: Composer could not install the
packages without the `zip` extension. The PostgreSQL driver is not in the image
either and had to be added. Choosing how PHP serves requests is a decision
of its own (`mod_php`, PHP-FPM behind nginx, FrankenPHP, or Laravel Octane),
with the consequences of section 4.6. The Node.js images are a plain
`npm ci` and `node`.

### 4.9 Separation and shared language

NestJS and Express are API servers. Laravel is a full-stack framework: our
prototype still contains its views (`resources/views`), its front-end pipeline
(`vite.config.js`, `package.json`) and its web routes, unused but present. It
can be used as an API only, and our prototype does, but this is the kind of
code base the subject discourages.

NestJS and Express are written in TypeScript, like the React web client. The
members can review each other's code across the boundary, and the server and
the clients share the same tooling: npm, the linter, the test runner and the
continuous integration. The types themselves do not need a shared language,
since a typed client can be generated from the OpenAPI description whatever the
server language.

### 4.10 Performance

| Measure | NestJS | Express | Laravel |
| --- | --- | --- | --- |
| GET /auth/me, requests per second (50 connections) | 3042 | 3657 | 240 |
| GET /auth/me, latency p50 / p99 (ms) | 15 / 23 | 13 / 17 | 206 / 248 |
| Failed requests | 0 | 0 | 0 |

NestJS costs about 17 percent of the throughput of Express. Laravel in
FrankenPHP's classic mode boots the framework for every request, which explains
most of its gap. Laravel Octane keeps the application in memory and is much
faster, but its documentation warns that the container, the request and the
configuration injected into long lived objects can then be stale, and that
static data leaks memory between requests. Performance has a low weight: a few
hundred requests per second would already serve the product, so this criterion
does not decide the choice.

## 5. Final choice

**Choice: NestJS.**

| Criterion | Weight | NestJS | Express | Laravel | Evidence |
| --------- | -----: | -----: | ------: | ------: | -------- |
| API contract | 15 | 4 | 2 | 5 | Section 4.3: drift test, field details |
| Structure | 15 | 5 | 2 | 4 | Section 4.4 |
| Separation | 5 | 5 | 5 | 3 | Section 4.9 |
| Hooks | 15 | 5 | 3 | 3 | Section 4.5: processes, first detection |
| Security | 20 | 4 | 3 | 2 | Section 4.6: attack suite, runtime exposure |
| Delegated authentication | 10 | 4 | 4 | 5 | Section 4.7, not prototyped |
| Deployment | 10 | 5 | 5 | 2 | Section 4.8 |
| Shared language | 5 | 5 | 5 | 1 | Section 4.9 |
| Performance | 5 | 5 | 5 | 2 | Section 4.10 |
| **Weighted score out of 100** | | **91** | **66** | **64** | Sum of weight times score, divided by 5 |

NestJS is the only candidate that meets every requirement of section 1 without
a weak point. It generates the contract with the clients from the code and
keeps it in step with the routes, it imposes modules and dependency injection
that keep the business logic behind abstractions, it runs the hooks in the API
process with the same services, it blocked the most attacks with its defaults,
and it shares the language of the web client.

**Why not Express alone.** Express gives the same runtime and the same
libraries, but everything NestJS enforces becomes a convention we would write
and maintain ourselves: the error handler, the validation, the dependency
wiring and above all the OpenAPI description, which the drift test showed going
out of date. The 1 MiB body answered with a 500 is the kind of gap such
conventions leave.

**Why not Laravel.** Laravel generates the best API description of the three
and has the best OAuth 2.0 library. For this project it loses on what the
subject weighs the most: the hooks need a second process and start late, the
runtime adds a layer that carried the most severe vulnerabilities of 2026, the
deployment needs PHP specific configuration, it is a full-stack framework, and
it would put a different language between the server and the web client.

**Accepted drawbacks.**

- NestJS relies on decorators and metadata emitted by TypeScript, which hide
  part of the behavior. New members need to learn modules, providers and guards
  before they are productive.
- It is heavier than Express: more code for the same scope, 180 production
  packages against 126, a larger image, and about 17 percent less throughput.
- The OpenAPI description only lists the routes until the DTO fields are
  described, by `@ApiProperty` or by the `@nestjs/swagger` compiler plugin.

**Carried to the MVP from this study.**

- Enable the `@nestjs/swagger` compiler plugin and add the test, run by the
  continuous integration, that fails when the implementation and the
  description disagree.
- Compare the password against a hash even when the email is unknown, and
  check it with the timing attack of the benchmark.
- Remove the `X-Powered-By` header.
- Replace the TypeORM `synchronize` option of the prototype with migrations.
- Run the dependency audit in the continuous integration.

## 6. Practical evidence {#backend_selection_evidence}

Everything above can be reproduced from the repository. Docker, Node.js 24 and
OpenSSL are needed.

```sh
make backend-bench        # or ./pocs/backend/backend-bench/run.sh
```

The command builds the three images, runs the benchmark and writes
`pocs/backend/backend-bench/results.json` and `pocs/backend/backend-bench/results.md`. It takes about
five minutes. Numbers change slightly from one machine and one run to another;
the verdicts do not.

| Evidence | Where |
| -------- | ----- |
| NestJS prototype | `pocs/backend/nestJs-poc/` |
| Express prototype | `pocs/backend/express-poc/` |
| Laravel prototype | `pocs/backend/laravel-poc/` |
| Benchmark, attack suite and drift test | `pocs/backend/backend-bench/bench.mjs`, `pocs/backend/backend-bench/drift/` |
| Resource limits and secrets of the run | `pocs/backend/backend-bench/compose.yaml`, `pocs/backend/backend-bench/run.sh` |
| Results of the run quoted here | `pocs/backend/backend-bench/results.json`, `pocs/backend/backend-bench/results.md` |
| Search in the CISA catalog of exploited vulnerabilities | `tools/kev.mjs` |

Each prototype can also be started on its own with its `compose.yaml` and its
`.env.example`, and its browsable interface is served at `/docs`.

## 7. Exploration by member

| Member | Back-end exploration |
| ------ | -------------------- |
| Titouan | NestJS prototype: project, user entity, registration and login with JWT. Laravel prototype: authentication and webhook. |
| Savinien | NestJS prototype: OpenAPI, JWT guard, hooks. Express prototype. Laravel prototype: Scramble, JWT middleware, webhook signature, hooks and Docker image. Benchmark and this document. |
| Enzo, Arthur | Front-end exploration, covered by the front-end technology selection. |

## 8. Sources

- [PHP advisories and changelog](https://www.php.net/ChangeLog-8.php)
- [CISA, critical vulnerabilities in PHP require immediate patching (October 2026)](https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching)
- [BleepingComputer, PHP security updates fix 18 flaws (November 2026)](https://www.bleepingcomputer.com/news/security/php-security-updates-fix-18-flaws-including-critical-rce-bugs/)
- [CISA, Known Exploited Vulnerabilities catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- [Help Net Security, CVE-2024-4577 exploited to deliver ransomware](https://www.helpnetsecurity.com/2024/06/13/cve-2024-4577-exploited/)
- [GitGuardian, exploiting public APP_KEY leaks](https://blog.gitguardian.com/exploiting-public-app_key-leaks/)
- [Synacktiv, Laravel APP_KEY leakage analysis](https://synacktiv.com/en/publications/laravel-appkey-leakage-analysis)
- [Node.js, October 2026 security releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Laravel Octane documentation](https://laravel.com/docs/octane)
- [Scramble documentation](https://scramble.dedoc.co/)
- [NestJS OpenAPI compiler plugin](https://docs.nestjs.com/openapi/cli-plugin)
