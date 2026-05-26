import sanitizeHtml from 'sanitize-html'
import { htmlToText } from 'html-to-text'

// Strict policy per spec: no media, no script, no style, no inline event
// handlers, no URL-bearing attributes other than <a href>. Anything not on
// the allowed-tag list is discarded entirely (not just stripped of attrs).
const sanitizeConfig: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span', 'a',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'kbd', 'samp', 'var',
    'b', 'i', 'u', 's', 'strong', 'em',
    'sub', 'sup', 'small',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'dl', 'dt', 'dd',
    'figure', 'figcaption', 'mark',
    'cite', 'q', 'abbr', 'address',
  ],
  allowedAttributes: {
    a: ['href'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  disallowedTagsMode: 'discard',
}

export function sanitizeHtmlBody(html: string): string {
  return sanitizeHtml(html, sanitizeConfig)
}

type GraphBodyLike = { contentType?: string; content?: string } | undefined

export function extractBody(
  uniqueBody: GraphBodyLike,
  body: GraphBodyLike,
): { bodyText: string; bodyHtml?: string } {
  if (uniqueBody?.contentType === 'text' && uniqueBody.content) {
    return { bodyText: uniqueBody.content }
  }
  if (body?.contentType === 'text' && body.content) {
    return { bodyText: body.content }
  }

  const html = uniqueBody?.content ?? body?.content ?? ''
  if (!html) return { bodyText: '' }

  const sanitized = sanitizeHtmlBody(html)
  const text = htmlToText(sanitized, { wordwrap: 78 })
  return { bodyText: text, bodyHtml: sanitized }
}
