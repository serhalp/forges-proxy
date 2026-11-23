# forges-proxy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fserhalp%2Fforges-proxy%2Ftree%2Fmain%2Fdemos%2Fvercel&project-name=forges-proxy&repository-name=forges-proxy&env=FORGES_PROXY_PUBLIC&envDescription=1%20for%20a%20public%2C%20read-only%20instance)

Live public read-only instance: <https://forges-proxy-demo.vercel.app/>
([`/docs`](https://forges-proxy-demo.vercel.app/docs)).

Routes all paths to a single Vercel Function at `api/index.ts`. Public reads emit
`CDN-Cache-Control` headers respected by Vercel's CDN (60s fresh, 10m `stale-while-revalidate`),
without webhook cache purging. Requests and webhook events from `handleEvents` are logged with
[evlog](https://evlog.dev). Unconfigured forges that support anonymous reads are enabled by default.

## Deploy your own

Clicking **Deploy with Vercel** clones this directory into a new repository and prompts for
`FORGES_PROXY_PUBLIC` (set to `1` for a public, read-only instance). For a private instance, set
`FORGES_PROXY_SECRET` instead and pass `Authorization: Bearer <secret>` from callers.

In your Vercel project's environment variables, you can add `FORGES_GITHUB_TOKEN` for higher GitHub
rate limits (scoped to public repositories only on a public instance) and `FORGES_<KIND>_*` for
other forges (see [Configure](../../README.md#configure) and [Webhooks](../../README.md#webhooks)).
Redeploy after changing environment variables.
