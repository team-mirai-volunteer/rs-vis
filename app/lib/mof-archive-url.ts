/**
 * 財務省 予算書・決算書データベースのアーカイブトップ（年度別）URL。
 * `scripts/mof-budget-csv.ts` の `toEraLabel` と同じ元号変換だが、
 * こちらはURL用の英数字表記（heisei29/reiwa1 等）を組み立てる。
 */
export function mofArchiveUrl(fiscalYear: number): string {
  const slug = fiscalYear <= 2018 ? `heisei${fiscalYear - 1988}` : `reiwa${fiscalYear - 2018}`;
  return `https://www.bb.mof.go.jp/archive/${slug}.html`;
}
