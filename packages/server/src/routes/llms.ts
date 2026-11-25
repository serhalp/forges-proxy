import type { EventHandler } from "h3"
import { accessMode } from "../access.ts"
import type { Context } from "../context.ts"
import { accessNote, CALLING, CLIENT_URL, forgeName, SOURCE_URL, SUMMARY } from "../copy.ts"
import { cachedResponse } from "../response.ts"

/** The proxy in the llms.txt format (https://llmstxt.org), for agents. */
export function llmsRoute(context: Context): EventHandler {
  return (event) => {
    const mode = accessMode(context.env)
    // A private instance doesn't show how it's configured to callers without the secret.
    const providers = mode === "public" ? context.forges().providers : []
    const forges = providers.map(
      ({ forge, instance }) =>
        `- ${forgeName(forge)}: \`forge: "${forge}"\`, \`instance: "${instance}"\``,
    )
    const body = [
      "# forges-proxy",
      `> ${SUMMARY}`,
      accessNote(mode),
      CALLING,
      `For example:\n\n\`\`\`sh\ncurl -G ${new URL("github/github.com/repos.get", event.url)} \\\n  --data-urlencode 'args=[{"forge":"github","instance":"github.com","owner":"danielroe","name":"forges"}]'\n\`\`\``,
      "## Docs",
      [
        "- [OpenAPI document](openapi.json): every verb's arguments and results, as OpenAPI 3.1",
        "- [Metadata](_meta): the providers this instance serves, their capabilities, and its routed verbs, as JSON",
        "- [API reference](_docs): the OpenAPI document, rendered for people",
      ].join("\n"),
      ...(forges.length ? ["## Forges", forges.join("\n")] : []),
      "## Optional",
      [
        `- [@forges-proxy/client](${CLIENT_URL}): this proxy as \`forges\` providers, in TypeScript`,
        `- [Source](${SOURCE_URL}): the server, the client, and deployments for each platform`,
      ].join("\n"),
    ].join("\n\n")
    return cachedResponse(event.req, `${body}\n`, {
      mode,
      tags: providers.map((provider) => `${provider.forge}:${provider.instance}`),
      cdnHeaders: context.cdnHeaders,
      contentType: "text/markdown; charset=utf-8",
    })
  }
}
