# @forges-proxy/client

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/client-dark.png">
  <img alt="@forges-proxy/client: drop-in forges providers for your proxy. Without a proxy, createForges() holds a GitHub, GitLab, and Gitea token and calls each forge directly. With the proxy, createForges(await discoverProviders({ url, secret })) sends each call with the proxy secret to @forges-proxy/server, which calls the same forges with their tokens." src="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/client-light.png">
</picture>

Connects to a [`@forges-proxy/server`](https://github.com/serhalp/forges-proxy) deployment and
returns drop-in [`forges`](https://forges.link) providers.

```sh
pnpm add @forges-proxy/client forges
```

```ts
import { createForges } from "forges"
import { discoverProviders } from "@forges-proxy/client"

const forges = createForges(await discoverProviders({ url: "https://forges.example.com", secret }))
```

`discoverProviders()` returns a provider for every forge configured on the proxy (needed for
cross-forge calls like `forges.search.threads()`). By default it fetches `GET /` on startup. To
avoid fetching `GET /` on every server request or in the browser after SSR, describe the proxy once
with `describeProxy()` and pass the description:

```ts
import { discoverProviders, describeProxy } from "@forges-proxy/client"

const description = await describeProxy({ url, secret })
// Reuse `description` across requests with each caller's `fetch`:
const providers = await discoverProviders({ url, secret, description, fetch })
```

If you already know which forge you want to call, `proxyProvider()` constructs its provider
synchronously without fetching `GET /`:

```ts
import { proxyProvider } from "@forges-proxy/client"

const github = proxyProvider({ url, secret, forge: "github" })
const repo = await github.repos.get({ forge: "github", instance: "github.com", owner, name })
```

Until `refreshCapabilities()` is called to fetch `GET /`, `proxyProvider()` optimistically reports
all verbs as supported from `can()`, and any verb not routed by the proxy rejects with
`UnsupportedOperationError` when called. For self-hosted instances, pass `baseUrl` or `instance`.

Requests to the proxy time out after `timeout` milliseconds (default `30000`); `sources.stream()`
connections do not time out.

Web link helpers (`urlFor()`, `parseUrl()`, `referenceFor()`, `parseReferences()`, `webOrigin`) are
built in via `forges/web`. Other synchronous helpers (`normaliseMarkdown()`, `scopesFor()`,
`webhooks.events`, and link helpers for Cloudflare Artifacts and Cursor Origin) require the forge's
provider factory. Pass only the factories you need via `factories`, or pass `allFactories` from
`@forges-proxy/client/all` to bundle all forges:

```ts
import { github } from "forges/github"

const providers = await discoverProviders({ url, secret, factories: [github] })
```

Listings fetch one page per HTTP request, upstream errors are reconstructed into their `ForgeError`
subclasses, and verbs not routed by the proxy reject with `UnsupportedOperationError`.
`discoverProviders()` throws if the proxy is running an incompatible version of `forges`.
