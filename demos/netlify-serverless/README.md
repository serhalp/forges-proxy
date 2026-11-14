# forges-proxy on Netlify Functions

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/serhalp/forges-proxy&create_from_path=demos/netlify-serverless#FORGES_PROXY_PUBLIC=1)

A public, read-only instance: <https://forges-proxy-demo.netlify.app/>. [`/docs`](https://forges-proxy-demo.netlify.app/docs) lists what it routes.

One function on every path. Public reads are cached on Netlify's CDN, in the durable tier, and tagged by repository, so a forge webhook purges just that repository's entries. It logs through [evlog](https://evlog.dev), including each webhook event from `handleEvents`; swap in your own handling. Forges the env doesn't configure are served anonymously where they allow it.

## Deploy your own

The button copies this folder into a new repository and asks for the environment:

- `FORGES_PROXY_PUBLIC=1` for a public, read-only instance. For a private one, leave it empty and set `FORGES_PROXY_SECRET` after deploying; callers then send it as a bearer token.
- `FORGES_GITHUB_TOKEN` (optional) for GitHub's higher rate limit. On a public instance, give it no access beyond public data.

Other forges take `FORGES_<KIND>_*` variables (see the [main README](../../README.md#configure)). To purge entries when a repository changes and handle the forge's events, set up [webhooks](../../README.md#webhooks).
