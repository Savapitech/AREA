# AREA developer documentation {#mainpage}

AREA is an automation platform inspired by IFTTT and Zapier. Users subscribe to
third party services and build workflows: an Action detected in one service
starts one or more REActions in others. The product is made of an application
server, a web client and a mobile client that both query the server.

This website is the developer documentation of the project. It explains the
technical decisions, how they were tested and how to reproduce every measure
they rely on.

## Where to start

| If you want to | Read |
| -------------- | ---- |
| Know why the application server uses NestJS | @ref backend_selection |
| Reproduce the back-end measures | @ref backend_selection_evidence |
| Know why the data is stored in PostgreSQL | @ref persistence_selection |
| Know why the server uses TypeORM | @ref persistence_selection_orm |
| Reproduce the persistence measures | @ref persistence_selection_evidence |

## Project at a glance

| Item | Value |
| ---- | ----- |
| Application server | NestJS on Node.js 24, TypeScript |
| Database | PostgreSQL 17, through TypeORM |
| Web client | React, TypeScript |
| Mobile client | Android |
| Build and run | Docker Compose |
| Documentation | Doxygen with doxygen-awesome-css, built with `make docs` |

## Building this documentation

```sh
make docs
```

The website is written to `build/docs/html`. The continuous integration builds
it on every pull request, fails on any Doxygen warning, and publishes it from
`main`.

## Guides

- @subpage backend_selection
- @subpage persistence_selection
