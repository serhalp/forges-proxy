# forges-proxy on Netlify Server

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/serhalp/forges-proxy&create_from_path=demos/netlify-server#FORGES_PROXY_PUBLIC=1)

Live public read-only instance: <https://forges-proxy-server-demo.netlify.app/>
([`/docs`](https://forges-proxy-server-demo.netlify.app/docs)).

Runs the same setup as the [Netlify Functions demo](../netlify-serverless) (durable CDN caching,
webhook cache-tag purging, [evlog](https://evlog.dev) logging, and anonymous forge defaults) on a
long-lived Node.js server using [Netlify Server](https://docs.netlify.com/build/server/) (Early
Access). Requires a credit-based Netlify plan and Node.js 24+ (configured via `.node-version`). Each
client (by IP) is limited to 600 requests a minute (`rateLimit` in the server's `config`); over
that, Netlify answers `429`.

## Deploy your own

Clicking **Deploy to Netlify** clones this directory into a new repository and prompts for
environment variables:

- `FORGES_PROXY_PUBLIC=1` for a public, read-only instance. For a private instance, leave this blank
  and set `FORGES_PROXY_SECRET` after deploying; callers must then pass
  `Authorization: Bearer <secret>`.
- `FORGES_GITHUB_TOKEN` (optional) for higher GitHub rate limits. On a public instance, use a token
  scoped only to public repositories.

Configure other forges with `FORGES_<KIND>_*` variables (see
[Configure](../../README.md#configure)). To purge cached reads on repository changes and process
webhook events, see [Webhooks](../../README.md#webhooks).
