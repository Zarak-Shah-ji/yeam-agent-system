/**
 * Below this, a rate is noise. Five is not a statistical threshold — it is the
 * point below which quoting a percentage to a biller is actively misleading.
 *
 * One constant for every rate in the product: a claim's paid history, a code's
 * denial rate, a payer's appeal win rate. "Thin" meaning five on one screen and
 * three on the next would mark the same payer trustworthy on one page and not
 * on the other.
 *
 * Its own module, with no imports, because it is read on the client. It used
 * to live in lib/claims/code-signals.ts, which pulls in the procedure-code
 * table — 22KB of CPT descriptions shipped to the payer scorecard to learn the
 * number five. code-signals re-exports it, so nothing that imported it there
 * had to change.
 */
export const MIN_SAMPLE = 5
