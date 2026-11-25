# forges-proxy on Nitro

Mounts `@forges-proxy/server` under `/forges` inside a [Nitro](https://nitro.build) app.
`server/routes/forges/[...path].ts` (and `index.ts` for `/forges`) strips the `/forges` prefix and
forwards the Web `Request` to `server.fetch`. The client
(`discoverProviders({ url: "http://localhost:3000/forges" })`), `/forges/_docs`, and
`/forges/openapi.json` all resolve relative to the mount path.

## Run

```sh
npm install
FORGES_PROXY_PUBLIC=1 npm run dev
```

Or build and run the production server:

```sh
npm run build
FORGES_PROXY_PUBLIC=1 npm start
```

The proxy is mounted at `http://localhost:3000/forges/`. Set `FORGES_PROXY_SECRET=<secret>` instead
of `FORGES_PROXY_PUBLIC=1` for a private instance, `FORGES_GITHUB_TOKEN=<token>` for higher GitHub
rate limits, and `FORGES_<KIND>_*` for other forges (see [Configure](../../README.md#configure) and
[Webhooks](../../README.md#webhooks)).
