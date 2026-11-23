# forges-proxy on Hono

Mounts `@forges-proxy/server` under `/forges` inside an existing [Hono](https://hono.dev) app.
`app.mount("/forges", server.fetch)` strips the `/forges` prefix before passing requests to the
proxy. The client (`discoverProviders({ url: "http://localhost:3000/forges" })`), `/forges/docs`,
and `/forges/openapi.json` all resolve relative to the mount path.

## Run

```sh
npm install
FORGES_PROXY_PUBLIC=1 npm start
```

The server listens on `PORT` (defaults to `3000`) with the proxy mounted at
`http://localhost:3000/forges/`. Set `FORGES_PROXY_SECRET=<secret>` instead of
`FORGES_PROXY_PUBLIC=1` for a private instance, `FORGES_GITHUB_TOKEN=<token>` for higher GitHub rate
limits, and `FORGES_<KIND>_*` for other forges (see [Configure](../../README.md#configure) and
[Webhooks](../../README.md#webhooks)).
