# forges-proxy on Docker

A public, read-only instance on [Fly.io](https://fly.io): <https://forges-proxy-demo.fly.dev/>.
[`/docs`](https://forges-proxy-demo.fly.dev/docs) lists what it routes.

The proxy on Node.js, served by [srvx](https://srvx.h3.dev), in an Alpine image. Nothing caches in
front of it here. Responses carry the standard `CDN-Cache-Control` and `Cache-Tag`, so a CDN you put
in front can cache public reads. It logs through [evlog](https://evlog.dev), including each webhook
event from `handleEvents`; swap in your own handling. Forges the env doesn't configure are served
anonymously where they allow it.

## Run your own

From the repository root:

```sh
docker build -f demos/docker/Dockerfile -t forges-proxy .
docker run -p 3000:3000 -e FORGES_PROXY_PUBLIC=1 forges-proxy
```

Pass `-e FORGES_PROXY_SECRET=<secret>` instead for a private instance,
`-e FORGES_GITHUB_TOKEN=<token>` for GitHub's higher rate limit, and `FORGES_<KIND>_*` for other
forges (see the [main README](../../README.md#configure)). For webhooks, see
[Webhooks](../../README.md#webhooks).

On Fly.io, change `app` in `fly.toml`, set the environment with `fly secrets set`, and run
`fly deploy --config demos/docker/fly.toml .` from the repository root.

Outside this monorepo you don't need the Dockerfile's workspace steps:
`npm install @forges-proxy/server srvx` and run `node server.ts`.
