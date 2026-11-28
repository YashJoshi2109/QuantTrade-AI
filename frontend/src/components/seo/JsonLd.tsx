/**
 * JSON-LD <script>. "<" is escaped so a string value can never close the
 * script element early (e.g. "</script>" inside a title).
 */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />
}
