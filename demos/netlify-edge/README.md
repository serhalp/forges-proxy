# forges-proxy on Netlify Edge Functions

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/serhalp/forges-proxy&create_from_path=demos/netlify-edge#FORGES_PROXY_PUBLIC=1)

Live public read-only instance: <https://forges-proxy-edge-demo.netlify.app/>
([`/_docs`](https://forges-proxy-edge-demo.netlify.app/_docs)).

Runs the proxy in a catch-all Netlify Edge Function. Public reads are cached on Netlify's CDN with a
60-second TTL and 10-minute `stale-while-revalidate` window, without webhook cache purging. If you
need tag-based cache purging on webhook deliveries, use the
[Netlify Functions demo](../netlify-serverless) or [Netlify Server demo](../netlify-server).
Requests and webhook events from `handleEvents` are logged with [evlog](https://evlog.dev).
Unconfigured forges that support anonymous reads are enabled by default. Each client (by IP) is
limited to 600 requests a minute (`rateLimit` in the edge function's `config`); over that, Netlify
answers `429`.

## Deploy your own

Clicking **Deploy to Netlify** clones this directory into a new repository and prompts for
environment variables:

- `FORGES_PROXY_PUBLIC=1` for a public, read-only instance. For a private instance, leave this blank
  and set `FORGES_PROXY_SECRET` after deploying; callers must then pass
  `Authorization: Bearer <secret>`.
- `FORGES_GITHUB_TOKEN` (optional) for higher GitHub rate limits. On a public instance, use a token
  scoped only to public repositories.

Configure other forges with `FORGES_<KIND>_*` variables (see
[Configure](../../README.md#configure)). For webhook setup, see
[Webhooks](../../README.md#webhooks).
