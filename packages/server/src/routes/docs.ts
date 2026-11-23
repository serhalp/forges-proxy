import type { EventHandler } from "h3"

const SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.4"

export const docsRoute: EventHandler = (event) => {
  event.res.headers.set("content-type", "text/html; charset=utf-8")
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>forges proxy</title>
  </head>
  <body>
    <script id="api-reference" data-url="openapi.json"></script>
    <script src="${SCALAR}"></script>
  </body>
</html>
`
}
