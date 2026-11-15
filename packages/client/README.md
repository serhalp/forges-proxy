# @forges-proxy/client

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/client-dark.png">
  <img alt="@forges-proxy/client: drop-in forges providers for your proxy. Without a proxy, createForges() holds a GitHub, GitLab and Gitea token and calls each forge directly. With the proxy, createForges(await connect({ url, secret })) sends each call with the proxy secret to @forges-proxy/server, which calls the same forges with their tokens." src="https://raw.githubusercontent.com/serhalp/forges-proxy/main/assets/client-light.png">
</picture>

Turns a [forges-proxy](https://github.com/serhalp/forges-proxy) credential broker back into [`forges`](https://forges.link) providers, so code written against `forges` works unchanged.

```sh
pnpm add @forges-proxy/client forges
```

```ts
import { createForges } from "forges"
import { connect } from "@forges-proxy/client"

const forges = createForges(await connect({ url: "https://forges.example.com", secret }))
```

`urlFor()`, `parseUrl()` and the other sync helpers need the forge's own code, which you pass in for the forges you use, so your bundle carries only those. Without a forge's factory, its helpers return nothing:

```ts
import { github } from "forges/github"

const providers = await connect({ url, secret, factories: [github] })
```

Or all of them, which bundles every forge:

```ts
import { allFactories } from "@forges-proxy/client/all"

const providers = await connect({ url, secret, factories: allFactories })
```

Listings read one page per request, errors come back as the same classes, and verbs the proxy doesn't route reject with `UnsupportedOperationError`. `connect()` warns when the proxy runs an incompatible `forges`.
