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

`discoverProviders()` fetches `GET /` on startup. To avoid fetching `GET /` on every server request
or in the browser after SSR, fetch the index once with `fetchProxyIndex()` and pass it via `index`:

```ts
import { discoverProviders, fetchProxyIndex } from "@forges-proxy/client"

const index = await fetchProxyIndex({ url, secret })
// Reuse `index` across requests with each caller's `fetch`:
const providers = await discoverProviders({ url, secret, index, fetch })
```

Requests to the proxy time out after `timeout` milliseconds (default `30000`); `sources.stream()`
connections do not time out.

Synchronous helpers (`urlFor()`, `parseUrl()`, `referenceFor()`, etc.) run locally and need the
forge's provider factory. Pass only the factories you use so you don't bundle unused providers:

```ts
import { github } from "forges/github"

const providers = await discoverProviders({ url, secret, factories: [github] })
```

Or import `allFactories` to include every forge:

```ts
import { allFactories } from "@forges-proxy/client/all"

const providers = await discoverProviders({ url, secret, factories: allFactories })
```

Without a factory for a forge, its synchronous helpers return `undefined` (or `[]` / the input
string).

Listings fetch one page per HTTP request, upstream errors are reconstructed into their `ForgeError`
subclasses, and verbs not routed by the proxy reject with `UnsupportedOperationError`.
`discoverProviders()` throws if the proxy is running an incompatible version of `forges`.
