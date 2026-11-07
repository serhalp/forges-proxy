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

Listings read one page per request, errors come back as the same classes, and verbs the proxy doesn't route reject with `UnsupportedOperationError`. `connect()` warns when the proxy runs an incompatible `forges`.
