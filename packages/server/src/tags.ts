import type { ForgeEvent, RepoRef } from "forges"
import { affectedKeys, repoKey } from "forges"

// Cap per-response repo tags to stay within CDN header size limits; responses exceeding this keep only the instance tag.
const MAX_REPO_TAGS = 50

/**
 * Computes cache tags for a response from every `RepoRef` in its arguments and result, plus the
 * `<forge>:<instance>` tag. Emits both path (`owner/name`) and `@externalId` keys when available
 * because read requests usually specify `owner/name` whereas webhook events include `externalId`
 * (which `repoKey()` prefers).
 */
export function responseTags(forge: string, instance: string, ...values: unknown[]): string[] {
  const repos = new Set(values.flatMap((value) => [...reposIn(value)].flatMap(keysOf)))
  return [`${forge}:${instance}`, ...(repos.size <= MAX_REPO_TAGS ? repos : [])]
}

/** Computes all repository cache tags (both path and `@externalId` forms) invalidated by `events`. */
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

function reposIn(value: unknown, found = new Set<RepoRef>()): Set<RepoRef> {
  if (Array.isArray(value)) {
    for (const item of value) {
      reposIn(item, found)
    }
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    if (isRepoRef(value)) {
      found.add(value)
    }
    for (const [key, item] of Object.entries(value)) {
      if (key !== "raw" && key !== "payload") {
        reposIn(item, found)
      }
    }
  }
  return found
}

function isRepoRef(value: object): value is RepoRef {
  return (
    "forge" in value &&
    typeof value.forge === "string" &&
    "instance" in value &&
    typeof value.instance === "string" &&
    "owner" in value &&
    typeof value.owner === "string" &&
    "name" in value &&
    typeof value.name === "string"
  )
}
