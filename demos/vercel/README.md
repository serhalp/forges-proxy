# forges-proxy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fserhalp%2Fforges-proxy%2Ftree%2Fmain%2Fdemos%2Fvercel&project-name=forges-proxy&repository-name=forges-proxy&env=FORGES_PROXY_PUBLIC&envDescription=1%20for%20a%20public%2C%20read-only%20instance)

A public, read-only instance: <https://forges-proxy-demo.vercel.app/>.
[`/docs`](https://forges-proxy-demo.vercel.app/docs) lists what it routes.

One function, `api/index.ts`, with every path rewritten to it. Public reads carry the standard
`CDN-Cache-Control`, which Vercel's CDN honours. Nothing purges them, so an entry stays fresh for 60
seconds and is served stale for up to 10 minutes while it refreshes. It logs through
[evlog](https://evlog.dev), including each webhook event from `handleEvents`; swap in your own
handling. Forges the env doesn't configure are served anonymously where they allow it.

## Deploy your own

The button copies this folder into a new repository and asks for `FORGES_PROXY_PUBLIC`: `1` for a
public, read-only instance. For a private one, set `FORGES_PROXY_SECRET` instead; callers then send
it as a bearer token.

Add `FORGES_GITHUB_TOKEN` in the project's environment variables for GitHub's higher rate limit (on
a public instance, with no access beyond public data), and `FORGES_<KIND>_*` for other forges (see
the [main README](../../README.md#configure)). Redeploy after changing them. For webhooks, see
[Webhooks](../../README.md#webhooks).
