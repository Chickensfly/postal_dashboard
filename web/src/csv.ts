/** Minimal RFC 4180 CSV parser -- no npm dependency, because the only thing
 *  this app ever parses client-side is its own admin-boundaries sample files
 *  (<=100 data rows, 17 columns), always written by
 *  scripts/build_admin_boundaries_catalog.py's `write_csv()`, which uses
 *  Python's `csv.QUOTE_NONNUMERIC` -- every field arrives double-quoted. Still
 *  handles unquoted fields, `""` as an escaped quote inside a quoted field, and
 *  a delimiter or newline embedded in a quoted field, in case that ever
 *  changes; real embedded commas/quotes are unlikely in this dataset but
 *  better safe than a silently misaligned table. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (c === ',') {
      endField()
      i += 1
      continue
    }
    if (c === '\r') {
      // Bare \r or the \r of a \r\n pair -- either way, swallow it and let the
      // following \n (if any) end the row.
      i += 1
      continue
    }
    if (c === '\n') {
      endRow()
      i += 1
      continue
    }
    field += c
    i += 1
  }
  // Trailing field/row when the text doesn't end with a newline. When it does
  // (the common case), the last `endRow()` above already consumed it and
  // field/row are both back to empty here, so this correctly adds nothing.
  if (field.length > 0 || row.length > 0) {
    endRow()
  }

  const [header, ...body] = rows
  return { header: header ?? [], rows: body }
}
