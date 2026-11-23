# forges-proxy on Node.js

Runs `@forges-proxy/server` as a standalone Node.js HTTP server using [srvx](https://srvx.h3.dev).
Unconfigured forges that support anonymous reads are enabled by default.

## Run

```sh
npm install
FORGES_PROXY_PUBLIC=1 npm start
```

The server listens on `PORT` (defaults to `3000`). Set `FORGES_PROXY_SECRET=<secret>` instead of
`FORGES_PROXY_PUBLIC=1` for a private instance, `FORGES_GITHUB_TOKEN=<token>` for higher GitHub rate
limits, and `FORGES_<KIND>_*` for other forges (see [Configure](../../README.md#configure) and
[Webhooks](../../README.md#webhooks)).
