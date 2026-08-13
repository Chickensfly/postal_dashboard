import type { Catalog, Format, Preview } from './types'

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

export const fetchCatalog = () => json<Catalog>('/api/catalog')

export const fetchPreview = (iso2: string, q: string, limit = 100, signal?: AbortSignal) =>
  json<Preview>(
    `/api/country/${iso2}/preview?limit=${limit}&q=${encodeURIComponent(q)}`,
    { signal },
  )

export const downloadUrl = (iso2: string, fmt: Format) =>
  `/api/download/${iso2}?fmt=${fmt}`

/** POSTs the selection and hands the resulting zip to the browser.
 *  A form-less POST can't trigger a native download, so the blob is materialized
 *  here — acceptable because the user picked the size and saw it beforehand. */
export async function downloadBundle(iso2: string[], fmt: Format): Promise<void> {
  const res = await fetch('/api/bundle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ iso2, fmt }),
  })
  if (!res.ok) throw new Error(`bundle failed: ${res.status} ${await res.text()}`)

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const named = /filename="([^"]+)"/.exec(disposition)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = named?.[1] ?? `postal-portal-${fmt}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
