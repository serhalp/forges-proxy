import process from "node:process"
import { purgeCache } from "@netlify/functions"

export type Purge = (tags: string[]) => Promise<void>

/**
 * Purges CDN entries by cache tag on Netlify, where functions get `NETLIFY_PURGE_API_TOKEN`. Undefined elsewhere:
 * entries expire by age.
 */
export function usePurge(env = process.env): Purge | undefined {
  return env.NETLIFY_PURGE_API_TOKEN ? (tags) => purgeCache({ tags }) : undefined
}
