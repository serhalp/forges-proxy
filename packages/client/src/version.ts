/**
 * The `forges` the proxy and client are built against. `forges` exports no version of its own, so a test keeps this in
 * step with the installed one.
 */
export const FORGES_VERSION = "0.4.1"

/** Whether `a` and `b` share a major version, or a minor while the major is 0, where semver lets minors break. */
export function compatible(a: string, b: string): boolean {
  const [majorA, minorA] = a.split(".")
  const [majorB, minorB] = b.split(".")
  return majorA === majorB && (majorA !== "0" || minorA === minorB)
}
