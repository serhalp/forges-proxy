# @forges-proxy/server

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/server-dark.png">
  <img alt="@forges-proxy/server: self-hosted API gateway for code forges. Web apps (even under a strict CSP or for forge APIs without CORS), CI and bots, AI agents, and any language call your deployment. Behind a cache, it holds the forge tokens, caches responses, rate-limits per caller and per route, and serves one typed API for 16 forges, whose webhooks purge affected cache entries and run your own handler." src="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/server-light.png">
</picture>

A self-hosted HTTP proxy and credential broker for [`forges`](https://forges.link), packaged as a
standard [Fetchable](https://fetchable.org) (`{ fetch(request) }`).

## Install

```sh
pnpm add @forges-proxy/server
```

## Use

On platforms that accept a Fetchable entrypoint directly:

```ts
export { default } from "@forges-proxy/server"
```

## Configure

Configure providers and access mode with `FORGES_*` environment variables, and pass platform hooks
(custom CDN cache headers, tag purging, or a custom upstream `fetch`) to `createServer()`. See the
[main README](https://github.com/serhalp/forges-proxy#readme) for configuration and API details.

## Deploy

See [`demos/`](https://github.com/serhalp/forges-proxy/tree/main/demos) for deployments on Netlify,
Cloudflare Workers, Vercel, Node, Docker, Hono, Nitro, and Fastify.
