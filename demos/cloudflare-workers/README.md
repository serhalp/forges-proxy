# forges-proxy on Cloudflare Workers

A public, read-only instance: <https://demo.forges-proxy.workers.dev/>. [`/docs`](https://demo.forges-proxy.workers.dev/docs) lists what it routes.

The proxy as a Worker, configured in `cloudflare.config.ts` and deployed with Cloudflare's `cf` CLI. Cloudflare doesn't cache what a Worker returns, so every request runs it and nothing is purged. It logs through [evlog](https://evlog.dev), including each webhook event from `handleEvents`; swap in your own handling. Forges the env doesn't configure are served anonymously where they allow it.

## Deploy your own

Copy this folder, rename the Worker in `cloudflare.config.ts`, then:

```sh
npm install
echo "FORGES_GITHUB_TOKEN=<token>" > .dev.vars   # optional, for GitHub's higher rate limit
npm run dev                                      # locally
npx cf deploy --secrets-file .dev.vars           # to your account
```

The config makes it public (`FORGES_PROXY_PUBLIC`). For a private instance, replace that binding with a `FORGES_PROXY_SECRET` secret. Other forges take `FORGES_<KIND>_*` bindings (see the [main README](../../README.md#configure)). For webhooks, see [Webhooks](../../README.md#webhooks).
