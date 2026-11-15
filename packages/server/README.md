# @forges-proxy/server

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/server-dark.png">
  <img alt="@forges-proxy/server: self-hosted API gateway for code forges. Web apps (even under a strict CSP or for forge APIs without CORS), CI and bots, AI agents, and any language call your deployment. Behind a cache, it holds the forge tokens, caches responses, rate-limits per caller and per route, and serves one typed API for 14 forges, whose webhooks purge affected cache entries and run your own handler." src="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/server-light.png">
</picture>

A self-hostable credential broker for [`forges`](https://forges.link), as a [Fetchable](https://fetchable.org): one API, one cache, and one set of credentials in front of every forge you configure.

```sh
pnpm add @forges-proxy/server
```

Where your platform takes a Fetchable, this is the whole entry:

```ts
export { default } from "@forges-proxy/server"
```

Configure it with `FORGES_*` environment variables, and pass platform specifics (CDN headers, purging, the providers' `fetch`) to `createServer()`. See the [README](https://github.com/serhalp/forges-proxy#readme) for configuration and the API, and [`demos/`](https://github.com/serhalp/forges-proxy/tree/main/demos) for Netlify, Cloudflare Workers, Vercel, Node, Docker, Hono, Nitro, and Fastify.
