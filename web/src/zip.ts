import { downloadZip } from 'client-zip'

export type ZipEntry = { name: string; url: string }

/** Fetches every entry and bundles them into one zip, saved via a temporary
 *  object URL -- entirely client-side, no backend involved. This only works
 *  because every file it's used for (sample CSVs) is same-origin and tiny (100
 *  rows each); it is not a general-purpose replacement for the old server-side
 *  streaming bundle, which could zip arbitrarily large full files. */
export async function downloadSelectionZip(entries: ZipEntry[], zipFilename: string): Promise<void> {
  const files = await Promise.all(
    entries.map(async ({ name, url }) => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} fetching ${name}`)
      return { name, input: res }
    }),
  )
  const blob = await downloadZip(files).blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = zipFilename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
