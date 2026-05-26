import { MailError } from './errors'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export type GetTokenFn = () => Promise<string>

type Query = Record<string, string | number | undefined>

export type GraphRequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  rawUrl?: string
}

export async function graphRequest<T>(
  getToken: GetTokenFn,
  path: string,
  opts: GraphRequestOpts = {},
): Promise<T> {
  let token: string
  try {
    token = await getToken()
  } catch (err) {
    throw new MailError(
      'AUTH_EXPIRED',
      `Failed to acquire access token: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
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

  let response: Response
  try {
    response = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    throw new MailError(
      'NETWORK',
      `Graph request failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    )
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new MailError('AUTH_EXPIRED', `Graph 401: ${bodyText}`)
    }
    if (response.status === 404) {
      throw new MailError('NOT_FOUND', `Graph 404: ${url}`)
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After')
      throw new MailError(
        'RATE_LIMITED',
        `Graph rate limited (Retry-After: ${retryAfter ?? 'unknown'})`,
      )
    }
    throw new MailError(
      response.status >= 500 ? 'PROVIDER' : 'UNKNOWN',
      `Graph ${response.status}: ${bodyText}`,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
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
