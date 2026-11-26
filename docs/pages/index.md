# AREA developer documentation {#mainpage}

AREA is an automation platform inspired by IFTTT and Zapier. Users subscribe to
third party services and build workflows: an Action detected in one service
starts one or more REActions in others. The product is made of an application
server, a web client and a mobile client that both query the server.

This website is the developer documentation of the project. It explains the
technical decisions, how they were tested and how to reproduce every measure
they rely on.

## Project at a glance

| Item | Value |
| ---- | ----- |
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
