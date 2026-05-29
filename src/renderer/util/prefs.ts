/**
 * Shared helpers for reading the boolean-ish prefs that the Setup screen
 * writes ('on' | 'off' as string values in the prefs table).
 *
 * The "anything-not-'off' is on (if pref exists)" rule means a stray
 * legacy value like 'true', '1', or 'yes' written by a future code path
 * still does the friendlier thing — defaulting to on rather than
 * silently dropping a user's intent. Only the literal 'off' (or null
 * when defaultOn=false) keeps the feature disabled.
 */

/** Read a boolean-ish pref. Returns the default when the pref is unset
 * (null). When set, only the literal 'off' string disables — every
 * other non-null value reads as enabled. */
export async function readBoolPref(
  key: string,
  defaultOn: boolean,
): Promise<boolean> {
  const v = await window.cairn.prefs.get(key)
  if (v === null) return defaultOn
  return v !== 'off'
}

/** Read a boolean-ish pref and return the canonical label ('on' or
 * 'off') for display in the Setup screen's value column. */
export async function readBoolPrefLabel(
  key: string,
  defaultOn: boolean,
): Promise<'on' | 'off'> {
  return (await readBoolPref(key, defaultOn)) ? 'on' : 'off'
}

/** Flip the pref's canonical state. Reads with the same defaulting
 * rule as readBoolPref so the user's intent inverts predictably even
 * if the stored value was a legacy non-canonical string. */
export async function flipBoolPref(
  key: string,
  defaultOn: boolean,
): Promise<void> {
  const wasOn = await readBoolPref(key, defaultOn)
  await window.cairn.prefs.set(key, wasOn ? 'off' : 'on')
}
