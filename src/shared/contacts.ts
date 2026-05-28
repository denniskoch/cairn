/** A single candidate row in the address-completion dropdown. Sources
 * are merged + deduped by email; ranking prefers personal contacts
 * over people-suggestions over GAL users (since the user curated
 * contacts themselves). */
export interface ContactSuggestion {
  /** Stable provider-side id (Graph Contact / Person / User id).
   * Undefined for the synthesized "use what I typed" fallback row. */
  id?: string
  /** Display name. Falls back to the local-part of the email when the
   * source has none (some person entries do not). */
  name: string
  /** Email — the only field guaranteed across every source. Used as
   * the dedupe key, so always lowercased on insert. */
  email: string
  /** Where this candidate came from. Drives the source-letter chip
   * shown next to the row (C/P/U) and the ranking. */
  source: 'contact' | 'person' | 'user'
  /** Optional context line — job title, company, "you", etc.
   * Rendered muted next to the email so the user can disambiguate
   * two people with the same name. */
  context?: string
}
