/**
 * Installed `forges` version that `@forges-proxy/client` was built against. Verified by a unit test
 * against `forges/package.json`.
 */
export const FORGES_VERSION = "0.4.1"

/** Returns true if versions `a` and `b` are semver-compatible (matching major, or matching minor when major is `0`). */
export function compatible(a: string, b: string): boolean {
  const [majorA, minorA] = a.split(".")
  const [majorB, minorB] = b.split(".")
  return majorA === majorB && (majorA !== "0" || minorA === minorB)
}
