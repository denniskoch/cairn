import pRetry, { AbortError } from 'p-retry'
import { MailError } from './errors'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/** How many times to retry transient failures (429 throttling, 5xx
 * transient errors). 4 retries = 5 total attempts, plenty for normal
 * Graph hiccups and aligned with what other Graph clients use. */
const MAX_RETRIES = 4

export type GetTokenFn = () => Promise<string>

type Query = Record<string, string | number | undefined>

export type GraphRequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  rawUrl?: string
  /** Extra request headers merged on top of the default
   * Authorization / Accept / Content-Type set. Used for things like
   * ConsistencyLevel=eventual that Graph requires for $search +
   * $count against /users. */
  headers?: Record<string, string>
}

export async function graphRequest<T>(
  getToken: GetTokenFn,
  path: string,
  opts: GraphRequestOpts = {},
): Promise<T> {
  return pRetry(() => attempt<T>(getToken, path, opts), {
    retries: MAX_RETRIES,
    // p-retry's onFailedAttempt callback runs between attempts and is
    // the right hook for honoring 429's Retry-After header. The library
    // does jittered exponential backoff by default for 5xx; this just
    // overrides the wait when Retry-After is set to a longer value.
    onFailedAttempt: async (err) => {
      const retryAfterMs = retryAfterFromError(err)
      if (retryAfterMs !== null) {
        await new Promise((r) => setTimeout(r, retryAfterMs))
      }
    },
  })
}

/** One attempt at the request. Throws an AbortError for permanent
 * failures (401/404/4xx other than 429) so p-retry stops immediately;
 * throws a regular Error for transient failures (429, 5xx, network)
 * so p-retry retries with backoff. */
async function attempt<T>(
  getToken: GetTokenFn,
  path: string,
  opts: GraphRequestOpts,
): Promise<T> {
  let token: string
  try {
    token = await getToken()
  } catch (err) {
    // Token acquisition failures are permanent within this request —
    // either the cached refresh token is bad (AUTH_EXPIRED, the renderer
    // pushes a re-auth screen) or msal has a transient network problem
    // it'll handle on its own next call. Either way, don't retry here.
    throw new AbortError(
      new MailError(
        'AUTH_EXPIRED',
        `Failed to acquire access token: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      ),
    )
  }

  const url = opts.rawUrl ?? buildUrl(path, opts.query)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (opts.headers) Object.assign(headers, opts.headers)

  let response: Response
  try {
    response = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    // Network errors are transient — let p-retry back off and retry.
    throw new MailError(
      'NETWORK',
      `Graph request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')

    // Permanent failures (auth, not-found, validation): abort so p-retry
    // doesn't keep hammering Graph with a request it'll never accept.
    if (response.status === 401) {
      throw new AbortError(new MailError('AUTH_EXPIRED', `Graph 401: ${bodyText}`))
    }
    if (response.status === 404) {
      throw new AbortError(new MailError('NOT_FOUND', `Graph 404: ${url}`))
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new AbortError(
        new MailError('UNKNOWN', `Graph ${response.status}: ${bodyText}`),
      )
    }

    // Transient failures: 429 throttling, 5xx, etc. Throw a regular
    // MailError so p-retry retries. The 429 case stashes Retry-After
    // on the error so onFailedAttempt can sleep for it.
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      const err = new MailError(
        'RATE_LIMITED',
        `Graph rate limited (Retry-After: ${retryAfter ?? 'unknown'})`,
      )
      ;(err as MailError & { retryAfter?: string | null }).retryAfter = retryAfter
      throw err
    }
    throw new MailError(
      'PROVIDER',
      `Graph ${response.status}: ${bodyText}`,
    )
  }

  // 204 No Content and any other 2xx response with an empty body must not
  // be JSON-parsed — Graph's /sendMail returns 202 with no body, and
  // calling response.json() on that throws "Unexpected end of JSON input"
  // even though the request succeeded.
  if (response.status === 204) {
    return undefined as T
  }
  const text = await response.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/** Parse Retry-After from a thrown error into milliseconds. Graph sends
 * it either as an integer-seconds string ("60") or an HTTP-date
 * (RFC 7231 section 7.1.3). Returns null if not present / unparseable
 * so p-retry uses its own backoff. */
function retryAfterFromError(err: unknown): number | null {
  const v = (err as { retryAfter?: string | null })?.retryAfter
  if (!v) return null
  // Seconds form: a non-negative integer.
  if (/^\d+$/.test(v)) return Number(v) * 1000
  // HTTP-date form: parse and diff from now.
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return Math.max(0, t - Date.now())
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(GRAPH_BASE + (path.startsWith('/') ? path : '/' + path))
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue
      url.searchParams.append(k, String(v))
    }
  }
  return url.toString()
}
