/** The choropleth scale, shared by the map and its legend.
 *
 * Row counts run from 139 (IE) to 892,800 (CA), so the bins are order-of-magnitude
 * steps — on a linear scale every country but a handful lands in the lightest bin.
 * The `--seq-*` variables are the dataviz sequential blue, validated in both themes
 * (see the note at the top of index.css). */

const BINS = [1_000, 10_000, 100_000, 500_000]

export const RAMP_VARS = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5'] as const

export const BIN_LABELS = ['<1K', '1K–10K', '10K–100K', '100K–500K', '500K+']

export const binOf = (rows: number) => BINS.filter((t) => rows >= t).length

/** Same 5-step ramp (RAMP_VARS above), different thresholds -- the Admin
 * Boundaries dataset's leaf-record counts run 6 (KW) to 81,911 (ID), nearly two
 * orders of magnitude lower than postal codes' 139–892,800, so reusing BINS
 * above would collapse almost every country into the lightest bin. Colours are
 * shared (already validated in both themes); only the breakpoints differ. */
const ADMIN_BOUNDARY_BINS = [300, 1_500, 6_000, 25_000]

export const ADMIN_BOUNDARY_BIN_LABELS = ['<300', '300–1.5K', '1.5K–6K', '6K–25K', '25K+']

export const binOfAdminBoundary = (rows: number) =>
  ADMIN_BOUNDARY_BINS.filter((t) => rows >= t).length
