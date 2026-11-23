# Product

## Register

brand

## Users

Developers evaluating whether to put `forges-proxy` in front of their forge integrations: people
building web apps, CI bots, AI agents, or non-JS services that talk to GitHub, GitLab, Tangled, and
other code forges. They usually land on the GitHub README and need to understand what the proxy does
and how to deploy it at a glance.

## Product Purpose

A self-hosted API gateway and credential broker for code forges. It holds forge tokens on the
server, caches public reads at the CDN, and exposes the `forges` API over HTTP with a typed
TypeScript client and an OpenAPI 3.1 spec. The README and diagrams should make the request flow and
deployment model immediately clear.

## Tone and Style

Direct, technical, and specific. Write like clear reference documentation: use concrete nouns, exact
header and option names, and real numbers instead of marketing adjectives.

## Anti-references

- SaaS landing pages: hero slogans, feature-card grids, sales copy.
- Enterprise architecture slides: cluttered boxes-and-arrows or clip-art diagrams.
- Generic AI aesthetics: purple/indigo gradients, all-caps tracked eyebrows, aphoristic one-liners.

## Design Principles

- Self-explanatory diagrams: diagrams should show the data flow clearly without relying on the
  surrounding prose.
- Concrete details: prefer exact API names, headers, and sizes over vague claims.
- Visual fit: diagrams use GitHub's light and dark palettes so they blend directly into the README.

## Accessibility & Inclusion

All images include complete alt text. Text meets WCAG AA contrast in both light and dark themes, and
meaning never relies on color alone.
