import type { EventHandler } from "h3"
import { accessMode } from "../access.ts"
import type { Context } from "../context.ts"
import { manifest } from "../manifest.ts"
import { cachedResponse } from "../response.ts"
import { CLIENT_URL, FORGE_NAMES, SOURCE_URL } from "../copy.ts"
import serverPackage from "../../package.json" with { type: "json" }

/** What a person opening the proxy in a browser sees: what it is, what it serves, where to go next. */
export function landingRoute(context: Context): EventHandler {
  return (event) => {
    const mode = accessMode(context.env)
    // A private instance doesn't show how it's configured to visitors without the secret.
    const providers = mode === "public" ? context.forges().providers : []
    const forges = providers
      .map((provider) => {
        const name = escape(FORGE_NAMES[provider.forge] ?? provider.forge)
        const instance = escape(provider.instance)
        const origin = provider.webOrigin
        return `<li><span>${name}</span>${
          origin ? `<a href="${escape(origin)}">${instance}</a>` : `<span>${instance}</span>`
        }</li>`
      })
      .join("\n")
    const access =
      mode === "public"
        ? "A public, read-only instance: anyone can call its read verbs."
        : "A private instance: send its secret as <code>Authorization: Bearer &lt;secret&gt;</code>."
    return cachedResponse(event.req, page(access, forges), {
      mode,
      tags: providers.map((provider) => `${provider.forge}:${provider.instance}`),
      cdnHeaders: context.cdnHeaders,
      contentType: "text/html; charset=utf-8",
    })
  }
}

function page(access: string, forges: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>forges-proxy</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #ffffff;
        --ink: #1f2328;
        --muted: #59636e;
        --line: #d1d9e0;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0d1117;
          --ink: #f0f6fc;
          --muted: #9198a1;
          --line: #3d444d;
        }
      }
      * {
        box-sizing: border-box;
        margin: 0;
      }
      body {
        background: var(--bg);
        color: var(--ink);
        font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
        padding: clamp(2.5rem, 8vw, 6rem) 1.25rem;
      }
      main,
      footer {
        max-width: 40rem;
        margin: 0 auto;
      }
      h1,
      code,
      ul.forges a,
      ul.forges span + span {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      }
      h1 {
        font-size: clamp(1.75rem, 5vw, 2.25rem);
        letter-spacing: -0.02em;
        line-height: 1.2;
      }
      p {
        max-width: 65ch;
        margin-top: 0.75rem;
      }
      .lede {
        color: var(--muted);
        font-size: 1.125rem;
      }
      code {
        font-size: 0.875em;
      }
      a {
        color: inherit;
        text-underline-offset: 0.2em;
        text-decoration-color: var(--muted);
      }
      a:hover {
        text-decoration-color: currentColor;
      }
      h2 {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--muted);
        margin-top: 2.5rem;
      }
      ul {
        list-style: none;
        padding: 0;
        margin-top: 0.75rem;
        border-top: 1px solid var(--line);
      }
      li {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        column-gap: 1rem;
        padding: 0.6rem 0;
        border-bottom: 1px solid var(--line);
      }
      ul.forges li > :last-child {
        color: var(--muted);
        font-size: 0.875rem;
      }
      footer {
        margin-top: 3rem;
        margin-bottom: 0;
        color: var(--muted);
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>forges-proxy</h1>
      <p class="lede">
        A self-hosted HTTP proxy and credential broker for
        <a href="https://forges.link"><code>forges</code></a>. It holds your forge tokens, caches public
        reads at the CDN, and exposes a single HTTP API across all configured forges.
      </p>
      <p>${access}</p>
      ${forges ? `<h2>Forges</h2>\n      <ul class="forges">\n${forges}\n      </ul>` : ""}
      <h2>Use it</h2>
      <ul>
        <li><a href="_docs">API reference</a><span>Every verb, with examples</span></li>
        <li><a href="openapi.json">OpenAPI document</a><span>For generated clients</span></li>
        <li><a href="_meta">Metadata</a><span>Providers, capabilities, and verbs, as JSON</span></li>
        <li>
          <a href="${CLIENT_URL}">@forges-proxy/client</a
          ><span>The proxy as <code>forges</code> providers, in TypeScript</span>
        </li>
        <li>
          <a href="${SOURCE_URL}">Source on GitHub</a><span>Deploy your own</span>
        </li>
      </ul>
    </main>
    <footer>forges-proxy ${escape(serverPackage.version)} · forges ${escape(manifest.forges)}</footer>
  </body>
</html>
`
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
