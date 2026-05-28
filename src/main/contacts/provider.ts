import type { ContactSuggestion } from '../../shared/contacts'
import type { GetTokenFn } from '../mail/graph-http'
import {
  fetchContactSuggestions,
  fetchPeopleSuggestions,
  mergeAndRank,
} from './graph-contacts'

/** Address-completion lookup. Hits People + Contacts in parallel,
 * merges + dedupes, returns the top `limit` candidates.
 *
 * /users (true GAL) is intentionally NOT queried here yet — it needs
 * User.ReadBasic.All which is admin-consent in most tenants. When we
 * wire a user-facing toggle for that scope, add fetchUserSuggestions
 * into the Promise.allSettled and the mergeAndRank call. */
export class ContactsProvider {
  constructor(private readonly getToken: GetTokenFn) {}

  async lookup(query: string, limit: number = 8): Promise<ContactSuggestion[]> {
    const q = query.trim()
    if (q.length < 2) return []

    const [contactsResult, peopleResult] = await Promise.allSettled([
      fetchContactSuggestions(this.getToken, q, limit),
      fetchPeopleSuggestions(this.getToken, q, limit),
    ])

    const contacts = settledValue(contactsResult, 'contacts')
    const people = settledValue(peopleResult, 'people')
    return mergeAndRank(contacts, people, [], limit)
  }
}

function settledValue<T>(
  result: PromiseSettledResult<T[]>,
  label: string,
): T[] {
  if (result.status === 'fulfilled') return result.value
  // One source failing shouldn't tank the whole dropdown — log it and
  // serve what we do have.
  console.warn(`contacts lookup: ${label} failed:`, result.reason)
  return []
}
