import type { ForgeEvent, RepoRef } from "forges"
import { affectedKeys, repoKey } from "forges"

// Past this, a response is tagged by its instance only; purges by repo miss it and `max-age` bounds its staleness.
const MAX_REPO_TAGS = 50

/**
 * Cache tags for a response: the `repoKey` of every repository its arguments or result name, and its instance. A
 * repo is tagged by both its path and its `externalId` key, since requests usually name the path while webhook
 * payloads carry the id, and `repoKey` prefers the id.
 */
export function responseTags(forge: string, instance: string, ...values: unknown[]): string[] {
  const repos = new Set(values.flatMap((value) => [...reposIn(value)].flatMap(keysOf)))
  return [`${forge}:${instance}`, ...(repos.size <= MAX_REPO_TAGS ? repos : [])]
}

/** The repo tags that `events` invalidate: everything `affectedKeys()` names, with both key forms. */
export function purgeTags(events: ForgeEvent[]): string[] {
  const tags = new Set<string>()
  for (const event of events) {
    for (const key of affectedKeys(event).repos) {
      tags.add(key)
    }
    for (const ref of reposIn({ ...event, payload: undefined })) {
      for (const key of keysOf(ref)) {
        tags.add(key)
      }
    }
  }
  return [...tags]
}

function keysOf(ref: RepoRef): string[] {
  const keys = ref.externalId ? [repoKey(ref)] : []
  if (ref.owner) {
    keys.push(repoKey({ ...ref, externalId: undefined }))
  }
  return keys
}

/** Every `RepoRef` nested in `value`, skipping forge payloads. */
function reposIn(value: unknown, found = new Set<RepoRef>()): Set<RepoRef> {
  if (Array.isArray(value)) {
    for (const item of value) {
      reposIn(item, found)
    }
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    const record = value as Record<string, unknown>
    if (
      typeof record.forge === "string" &&
      typeof record.instance === "string" &&
      typeof record.owner === "string" &&
      typeof record.name === "string"
    ) {
      found.add(record as unknown as RepoRef)
    }
    for (const [key, item] of Object.entries(record)) {
      if (key !== "raw" && key !== "payload") {
        reposIn(item, found)
      }
    }
  }
  return found
}
