/** In-browser search over a country's parquet file, via DuckDB compiled to WASM.
 *
 * This is what makes search work on a site with no backend at all (see
 * scripts/build_catalog.py's docstring for the rest of the static-site design):
 * the wasm binary and its worker script are bundled by Vite (imported with `?url`
 * below) and served as static assets alongside everything else, so there is no
 * runtime dependency on a CDN -- the whole site, search included, works offline
 * once loaded. `mvp`/`eh` are DuckDB-wasm's own two build variants (plain
 * WebAssembly vs. one using the exception-handling proposal); `selectBundle`
 * picks whichever the browser supports.
 */
import * as duckdb from '@duckdb/duckdb-wasm'
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url'
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url'

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
}

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null

/** One shared AsyncDuckDB instance for the whole app, created lazily on first
 *  search -- loading the wasm module on every page load for a feature many
 *  visits never touch would be wasteful. Every query after the first reuses it. */
function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES)
      const worker = new Worker(bundle.mainWorker!)
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker)
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker)
      return db
    })()
  }
  return dbPromise
}

// Source URL -> the virtual filename DuckDB knows it by, so switching back to a
// country/view already searched this session reuses the bytes already fetched
// instead of downloading its parquet file again.
const registered = new Map<string, string>()

async function fileRef(db: duckdb.AsyncDuckDB, url: string): Promise<string> {
  const existing = registered.get(url)
  if (existing) return existing
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`)
  const name = `f${registered.size}_${url.split('/').pop()}`
  await db.registerFileBuffer(name, new Uint8Array(await res.arrayBuffer()))
  registered.set(url, name)
  return name
}

/** Runs `sql` against the parquet file at `url`. Write the file reference in `sql`
 *  as the literal string `$file` (e.g. `read_parquet('$file')`) -- it's substituted
 *  with the registered virtual filename before the query runs. `params` fill `?`
 *  placeholders via a prepared statement, exactly like a normal DB driver -- this
 *  is what keeps a user's search text from being spliced into the query as SQL. */
export async function queryParquet<T = Record<string, unknown>>(
  url: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = await getDB()
  const name = await fileRef(db, url)
  const conn = await db.connect()
  try {
    const stmt = await conn.prepare(sql.replaceAll('$file', name))
    const table = await stmt.query(...params)
    return table.toArray().map((row) => row.toJSON() as T)
  } finally {
    await conn.close()
  }
}
