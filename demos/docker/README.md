# forges-proxy on Docker

Live public read-only instance on [Fly.io](https://fly.io): <https://forges-proxy-demo.fly.dev/>
([`/docs`](https://forges-proxy-demo.fly.dev/docs)).

Runs the proxy on Node.js via [srvx](https://srvx.h3.dev) inside an Alpine container. Responses
include standard `CDN-Cache-Control` and `Cache-Tag` headers if you place a CDN in front of the
container. Requests and webhook events from `handleEvents` are logged with
[evlog](https://evlog.dev). Unconfigured forges that support anonymous reads are enabled by default.

## Run your own

From the repository root:

```sh
docker build -f demos/docker/Dockerfile -t forges-proxy .
docker run -p 3000:3000 -e FORGES_PROXY_PUBLIC=1 forges-proxy
```

For a private instance, pass `-e FORGES_PROXY_SECRET=<secret>` instead. Add
`-e FORGES_GITHUB_TOKEN=<token>` for higher GitHub rate limits, and `FORGES_<KIND>_*` for other
forges (see [Configure](../../README.md#configure) and [Webhooks](../../README.md#webhooks)).

To deploy to Fly.io, update `app` in `fly.toml`, set secrets via `fly secrets set`, and run
`fly deploy --config demos/docker/fly.toml .` from the repository root.

Outside this monorepo, you don't need the multi-stage workspace build in `Dockerfile`: install
`@forges-proxy/server` and `srvx` directly and run `node server.ts`.
