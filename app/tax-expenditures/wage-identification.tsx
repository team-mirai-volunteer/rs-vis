export function WageIdentification() {
  return <section aria-label="賃上げ税制の交絡を切る分析計画" className="rounded-lg border border-mirai-border bg-card p-4">
    <h5 className="font-semibold">交絡を切る分析計画</h5>
    <p className="mt-2 text-sm leading-6">設計案・推定未実施。従業員2,000人の前後で、2024年改正による賃上げの変化を比較します。分かるのは境界付近の企業に対する中堅枠と大企業枠の相対効果です。</p>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-lg bg-mirai-surface p-3"><strong>2,000人以下の側</strong><p className="mt-1 leading-6">中堅枠の対象になり得る企業。中小企業向け制度を選べる企業と、グループの人数要件に抵触する企業を区別します。</p></div>
      <div className="rounded-lg bg-mirai-surface p-3"><strong>2,000人超の側</strong><p className="mt-1 leading-6">境界に近い大企業枠の企業。両側の改正前からの差を差し引き、景気や物価の共通変化を抑えます。</p></div>
    </div>
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-primary-accent underline underline-offset-4">推定に進むための3条件とデータの状況</summary>
      <ol className="mt-3 list-decimal space-y-3 pl-5 leading-6">
        <li><strong>同時に変わった支援を分離できること。</strong>中堅向けの設備投資・M&A支援も変化しています。同じ境界で効く施策を分離できなければ、賃上げ税制単独の効果とは判定しません。</li>
        <li><strong>企業構成と改正前の推移を確認できること。</strong>人数の調整、企業分割、境界前後の異なる成長傾向を点検します。税制利用の有無や実現した賃上げ率で比較群を選びません。</li>
        <li><strong>企業別の必要項目を取得できること。</strong>公開有報から複数企業の3年分の単体従業員数・平均給与を取得済みです。下の比較表で確認できます。ただし税法上の人数・継続雇用者給与との対応と所有要件は未確認です。費用対効果に必要な控除額も未取得です。</li>
      </ol>
      <p className="mt-3 leading-6">財務省には調査票情報の利用申出・オーダーメード集計の窓口がありますが、必要項目と企業の年次接続は要確認です。国税庁の第6期共同研究公募は終了しており、掲載された法人税テーマの控除明細は研究開発税制です。賃上げ税制の明細を取得できると確認したものではありません。</p>
      <ul className="mt-3 space-y-2 text-xs">
        <li><a className="text-primary-accent underline" href="https://www.mof.go.jp/tax_policy/councils/zeicho/241119_2-1.pdf" target="_blank" rel="noreferrer">2024年改正の比較（財務省、40–42ページ）↗</a></li>
        <li><a className="text-primary-accent underline" href="https://www.meti.go.jp/policy/economy/chuuken/index.html" target="_blank" rel="noreferrer">中堅企業向けの関連施策（経済産業省）↗</a></li>
        <li><a className="text-primary-accent underline" href="https://www.mof.go.jp/statistics/ordermade.htm" target="_blank" rel="noreferrer">統計データの利用条件（財務省）↗</a></li>
        <li><a className="text-primary-accent underline" href="https://www.nta.go.jp/about/organization/ntc/kyodokenkyu/koubo/index.htm" target="_blank" rel="noreferrer">共同研究の対象データ（国税庁）↗</a></li>
      </ul>
    </details>
    <CompanyPanel />
    <p className="mt-3 text-xs leading-5 text-mirai-text-secondary">確認日：2026年9月24日。分析計画の追加だけでは評価点を上げません。全国の削減可能額も、この局所比較からは算出しません。</p>
  </section>;
}
import { CompanyPanel } from './company-panel';
