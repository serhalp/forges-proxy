# forges-proxy on Cloudflare Workers

Live public read-only instance: <https://demo.forges-proxy.workers.dev/>
([`/docs`](https://demo.forges-proxy.workers.dev/docs)).

Runs the proxy on Cloudflare Workers, configured via `cloudflare.config.ts` and deployed with
Cloudflare's `cf` CLI. Note that Cloudflare does not automatically cache Worker responses at the CDN
edge on `workers.dev`, so requests execute the Worker directly unless you place a custom domain /
cache rule in front. Requests and webhook events from `handleEvents` are logged with
[evlog](https://evlog.dev). Unconfigured forges that support anonymous reads are enabled by default.
Each client (by IP) is limited to about 600 requests a minute per Cloudflare location, through the
`RATE_LIMITER` binding in `cloudflare.config.ts`; over that, the Worker answers `429`.

## Deploy your own

Update the Worker `name` in `cloudflare.config.ts`, then:

```sh
npm install
echo "FORGES_GITHUB_TOKEN=<token>" > .dev.vars   # optional, for higher GitHub rate limits
npm run dev                                      # run locally
npx cf deploy --secrets-file .dev.vars           # deploy to Cloudflare
```

`cloudflare.config.ts` defaults to public mode (`FORGES_PROXY_PUBLIC = "1"`). For a private
instance, replace that binding with a `FORGES_PROXY_SECRET` secret. Configure other forges with
`FORGES_<KIND>_*` bindings (see [Configure](../../README.md#configure) and
[Webhooks](../../README.md#webhooks)).
