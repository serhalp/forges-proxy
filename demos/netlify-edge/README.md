# forges-proxy on Netlify Edge Functions

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/serhalp/forges-proxy&create_from_path=demos/netlify-edge#FORGES_PROXY_PUBLIC=1)

A public, read-only instance: <https://forges-proxy-edge-demo.netlify.app/>.
[`/docs`](https://forges-proxy-edge-demo.netlify.app/docs) lists what it routes.

One edge function on every path, running close to the caller. Public reads are cached on Netlify's
CDN, but nothing purges them, so an entry stays fresh for 60 seconds and is served stale for up to
10 minutes while it refreshes. For purging, use the [Functions demo](../netlify-serverless). It logs
through [evlog](https://evlog.dev), including each webhook event from `handleEvents`; swap in your
own handling. Forges the env doesn't configure are served anonymously where they allow it.

## Deploy your own

The button copies this folder into a new repository and asks for the environment:

- `FORGES_PROXY_PUBLIC=1` for a public, read-only instance. For a private one, leave it empty and
  set `FORGES_PROXY_SECRET` after deploying; callers then send it as a bearer token.
- `FORGES_GITHUB_TOKEN` (optional) for GitHub's higher rate limit. On a public instance, give it no
  access beyond public data.

Other forges take `FORGES_<KIND>_*` variables (see the [main README](../../README.md#configure)).
For webhooks, see [Webhooks](../../README.md#webhooks).
