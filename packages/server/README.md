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

## Options

`createServer(options)` returns a Fetchable. The default export is `createServer()` with no options,
configured from `process.env` on its first request.

| Option            | Default                                                 | Description                                                                                                                                              |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env`             | `process.env`                                           | `FORGES_*` and `FORGES_PROXY_*` variables. `FORGES_PROXY_*` are read per request; providers are built once, on the first request.                        |
| `anonymousForges` | `false`                                                 | Also serve, anonymously, every forge `env` doesn't configure that supports unauthenticated reads at its default instance. Intended for public instances. |
| `forges`          | built from `env`                                        | A `Forges` registry to serve instead of building providers from `env`.                                                                                   |
| `fetch`           | `fetch`                                                 | The `fetch` providers use, e.g. one that caches upstream responses.                                                                                      |
| `purge`           | none; cached entries expire by age                      | `(tags) => Promise<void>`. Purges CDN cache entries by tag when a webhook delivery reports changes.                                                      |
| `handleEvents`    | none                                                    | `(events, { forge, instance }) => void \| Promise<void>`. Called with verified webhook events after purging, and awaited; throwing answers `500`.        |
| `cdnHeaders`      | `standardCdnHeaders` (`CDN-Cache-Control`, `Cache-Tag`) | `({ cacheControl, tags }) => headers`. Formats the CDN cache headers of cacheable public reads, e.g. for a CDN's own header names.                       |
| `logger`          | errors to `console.error`, no request logs              | `{ error(event), info?(event) }`, such as `console`, pino, or evlog's `log`. Pass the object itself, not unbound methods.                                |

The package also exports `standardCdnHeaders` and the types `ServerOptions`, `Server`, `Env`,
`Purge`, `HandleEvents`, `CdnHeaders`, and `Logger`.

## Deploy

See [`demos/`](https://github.com/serhalp/forges-proxy/tree/main/demos) for deployments on Netlify,
Cloudflare Workers, Vercel, Node, Docker, Hono, Nitro, and Fastify.
