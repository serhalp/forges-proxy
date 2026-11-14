# @forges-proxy/client

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
