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
