import type { EventHandler } from "h3"
import { accessMode } from "../access.ts"
import type { AccessMode } from "../access.ts"
import type { Context } from "../context.ts"
import { manifest } from "../manifest.ts"
import { cachedResponse } from "../response.ts"
import { CLIENT_URL, FORGE_KINDS, forgeName, SERVER_URL, SOURCE_URL } from "../copy.ts"
import serverPackage from "../../package.json" with { type: "json" }

type Status = "enabled" | "anonymous" | "disabled"

const STATUS: Record<Status, { label: string; rank: number }> = {
  enabled: { label: "Enabled", rank: 0 },
  anonymous: { label: "Anonymous only", rank: 1 },
  disabled: { label: "Disabled", rank: 2 },
}

/** What a person opening the proxy in a browser sees: what it is, what it serves, where to go next. */
export function landingRoute(context: Context): EventHandler {
  return (event) => {
    const mode = accessMode(context.env)
    // A private instance doesn't show how it's configured to visitors without the secret.
    const providers = mode === "public" ? context.forges().providers : []
    const rows = [
      ...providers.map((provider) => ({
        forge: provider.forge,
        instance: provider.instance,
        // `forges` has no web pages for some forges (Cursor Origin); their instance is still a host.
        origin: provider.webOrigin ?? `https://${provider.instance}`,
        status: (provider.authKind === "anonymous" ? "anonymous" : "enabled") as Status,
      })),
      ...FORGE_KINDS.filter((forge) => !providers.some((provider) => provider.forge === forge)).map(
        (forge) => ({ forge, instance: "", origin: undefined, status: "disabled" as Status }),
      ),
    ]
      .map((entry) => ({ ...entry, name: forgeName(entry.forge) }))
      .toSorted(
        (a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.name.localeCompare(b.name),
      )
    const forges = mode === "public" ? rows.map(renderRow).join("\n") : ""
    return cachedResponse(event.req, page(mode, forges), {
      mode,
      tags: providers.map((provider) => `${provider.forge}:${provider.instance}`),
      cdnHeaders: context.cdnHeaders,
      contentType: "text/html; charset=utf-8",
    })
  }
}

// Open for a public instance, shut for a private one.
const LOCKS: Record<AccessMode, string> = {
  public: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.75-1.4" /></svg>`,
  private: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>`,
}

function renderRow(entry: {
  name: string
  instance: string
  origin?: string
  status: Status
}): string {
  const instance = escape(entry.instance)
  const where = entry.origin
    ? `<a href="${escape(entry.origin)}">${instance}</a>`
    : instance && `<span>${instance}</span>`
  return `<tr class="${entry.status}"><td><span>${escape(entry.name)}</span>${where}</td><td><span class="dot" aria-hidden="true"></span>${STATUS[entry.status].label}</td></tr>`
}

function page(mode: AccessMode, forges: string): string {
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
        --on: #1a7f37;
        --off: #818b98;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0d1117;
          --ink: #f0f6fc;
          --muted: #9198a1;
          --line: #3d444d;
          --on: #3fb950;
          --off: #656c76;
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
      td :is(a, span) + :is(a, span) {
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
      .nowrap {
        white-space: nowrap;
      }
      .mode {
        color: var(--ink);
        font-weight: 600;
        white-space: nowrap;
      }
      .mode svg {
        width: 0.95em;
        height: 0.95em;
        margin-right: 0.3em;
        vertical-align: -0.1em;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.25;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .public svg {
        color: var(--on);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 0.75rem;
      }
      th {
        text-align: left;
        font-size: 0.8125rem;
        font-weight: 400;
        color: var(--muted);
        padding-bottom: 0.4rem;
      }
      tr {
        border-bottom: 1px solid var(--line);
      }
      thead tr {
        border-bottom-color: var(--line);
      }
      td {
        padding: 0.6rem 0;
        vertical-align: top;
      }
      td:first-child {
        display: flex;
        flex-wrap: wrap;
        column-gap: 0.75rem;
        align-items: baseline;
      }
      td :is(a, span) + :is(a, span) {
        color: var(--muted);
        font-size: 0.875rem;
      }
      th:last-child,
      td:last-child {
        /* As narrow as its widest label, so the dots line up. */
        width: 1%;
        white-space: nowrap;
        padding-left: 1rem;
      }
      .disabled td {
        color: var(--muted);
      }
      .dot {
        display: inline-block;
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 50%;
        margin-right: 0.45rem;
        border: 2px solid var(--off);
      }
      .enabled .dot {
        background: var(--on);
        border-color: var(--on);
      }
      .anonymous .dot {
        border-color: var(--on);
        background: linear-gradient(90deg, var(--on) 50%, transparent 50%);
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
        This is a <strong class="mode ${mode}">${LOCKS[mode]}${mode} instance</strong> of <a class="nowrap" href="${SOURCE_URL}">forges-proxy</a>, a self-hosted HTTP
        proxy and credential broker for <a href="https://forges.link"><code>forges</code></a>. It holds
        forge tokens, caches public reads at the CDN, and exposes a single HTTP API across all
        configured forges.
      </p>
      ${
        forges
          ? `<h2 id="forges">Forges</h2>
      <table aria-labelledby="forges">
        <thead><tr><th scope="col">Forge</th><th scope="col">Status</th></tr></thead>
        <tbody>
${forges}
        </tbody>
      </table>`
          : ""
      }
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
          <a href="${SERVER_URL}">@forges-proxy/server</a><span>Deploy your own instance</span>
        </li>
        <li>
          <a href="${SOURCE_URL}">Source on GitHub</a><span>Help build it!</span>
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
