# forges-proxy on Fastify

Mounts `@forges-proxy/server` under `/forges` inside an existing [Fastify](https://fastify.dev) app,
using `toNodeHandler` from [srvx](https://srvx.h3.dev) to bridge Fastify's Node HTTP streams to the
proxy's Fetchable `{ fetch }`. The `/forges` plugin scope disables Fastify's body parsers and calls
`reply.hijack()` so the proxy can read request bodies and write responses directly.

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
