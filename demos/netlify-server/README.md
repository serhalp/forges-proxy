# forges-proxy on Netlify Server

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/serhalp/forges-proxy&create_from_path=demos/netlify-server#FORGES_PROXY_PUBLIC=1)

A public, read-only instance: <https://forges-proxy-server-demo.netlify.app/>.
[`/docs`](https://forges-proxy-server-demo.netlify.app/docs) lists what it routes.

The same proxy as the [Functions demo](../netlify-serverless), as a long-lived Node.js server: CDN
caching, webhooks, logging, and anonymous forges all work the same.

[Netlify Server](https://docs.netlify.com/build/server/) is in Early Access. It needs a credit-based
plan, and Node.js 24+ to build, which `.node-version` sets.

## Deploy your own

The button copies this folder into a new repository and asks for the environment:

- `FORGES_PROXY_PUBLIC=1` for a public, read-only instance. For a private one, leave it empty and
  set `FORGES_PROXY_SECRET` after deploying; callers then send it as a bearer token.
- `FORGES_GITHUB_TOKEN` (optional) for GitHub's higher rate limit. On a public instance, give it no
  access beyond public data.

Other forges take `FORGES_<KIND>_*` variables (see the [main README](../../README.md#configure)). To
purge entries when a repository changes and handle the forge's events, set up
[webhooks](../../README.md#webhooks).
