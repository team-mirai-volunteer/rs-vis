import type { Assessment, AxisAssessment, Evidence } from './assessments';

const source = (title: string, file: string, pages: string, published = '2024年度（8月評価・更新版）'): Evidence => ({ title, url: `https://www8.cao.go.jp/hyouka/${file}`, pages, published });
const donation = source('内閣府・企業版ふるさと納税の延長に係る事前評価', 'r6sozei/r6sozei-03r.pdf', 'PDF 1・4–9ページ');
const tourism = source('内閣府・沖縄の観光地形成促進地域の事前評価', 'r6sozei/r6sozei-04r.pdf', 'PDF 2・7–11ページ');
const it = source('内閣府・沖縄の情報通信産業振興地域等の事前評価', 'r6sozei/r6sozei-05r.pdf', 'PDF 7–10ページ');
const jobs = source('内閣府・地方における企業拠点の強化を促進する税制措置の事前評価', 'r7sozei/r7sozei-01.pdf', 'PDF 9–15ページ', '2025年度');
const carry: Evidence = { title: '財務省・2024年度租特適用実態の総括表', url: 'https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/houkoku01.xlsx', pages: '「総括表」118行～（繰越税額控除）', published: '2026-02' };

function review(source: Evidence, scores: AxisAssessment[], effectEvidence: string | null, next: string, action = '追加検証'): Assessment {
  const verification = [
    { label: '制度要件と適用実績が公開されている', met: true, reason: '参照資料に制度要件と適用実績が掲載されている。' },
    { label: '効果分析の方法と結果が公開されている', met: effectEvidence !== null, reason: effectEvidence ?? 'この区分単独の効果分析は参照資料では確認できない。' },
    { label: '対象年度・制度に対応する因果推計がある', met: false, reason: '2024年度の当該税額控除に対応する比較対象を用いた因果推計は、参照資料では確認できない。' },
    { label: '追試可能な資料と期限付きの見直し基準がある', met: false, reason: '目標や期限の記載と、因果分析の追試資料・見直し判断基準の公開は区別する。後者の一式は確認できない。' },
  ];
  const score = effectEvidence === null ? 1 : 2;
  return { scores: [...scores, { score, reason: `4条件中${score}条件を確認。資料不足の${4 - score}条件を各1点減点。自己評価や目標達成だけでは因果推計の条件を満たさない。`, sources: [source] }], verification, next, action };
}

export const expandedAssessments: Record<string, Assessment> = {
  'mof-2024-r196': review(donation, [
    { score: 2, reason: '地方への資金・官民連携を促す目的と交付金との役割分担は明示される。企業が寄附先を選ぶ方式の優位性は主に制度趣旨による説明である。', sources: [donation] },
    { score: 1, reason: '自治体への調査では、新規事業や連携への寄与が報告される。ただし受益自治体の自己申告であり、税優遇がない場合との差や法人税部分だけの効果は特定できない。', sources: [donation] },
    { score: 1, reason: '減収額と寄附額の推移・推計方法は公開されるが、寄附額は社会的な純便益ではない。国税・地方税を通じた費用と追加的な成果の比較としては裏付けが弱い。', sources: [donation] },
    { score: 2, reason: '認定計画と実施報告、対象自治体の要件がある。一方、寄附先の偏りや企業の選択による資源配分の妥当性を検証する分析は参照資料では不足する。', sources: [donation] },
  ], '自治体へのアンケートの母数、回答割合、事業目標達成状況を公開。記述的分析として加点し、因果効果とは扱わない。', '寄附先別の成果・集中度と国税地方税を通じた費用を対応づけ、自己申告を外部検証する。寄附額の増大だけを継続理由にしない。'),
  'mof-2024-r76': review(tourism, [
    { score: 2, reason: '沖縄観光の高付加価値化や賃金向上という課題と認定要件は明確。税制による設備投資誘発が他の支援より適切かの比較は限定的。', sources: [tourism] },
    { score: 1, reason: '評価書は事業認定申請率の目標未達を報告し、投資の時間差を理由に挙げる。少数の認定実績はあるが、観光回復と税制の追加的効果を分離していない。', sources: [tourism] },
    { score: null, reason: '減収見込みと設備投資見込みはあるが、税制が追加的に誘発した投資や便益は算定されていない。対象年度の費用対効果を判定する資料が不足。', sources: [tourism] },
    { score: 2, reason: '付加価値・給与・雇用の認定条件がある。施設要件で対象を限定する合理性と、非対象施設との比較は追加検証が必要。', sources: [tourism] },
  ], '目標と認定実績を比較し、未達理由・認定条件を説明する記述的評価が公開される。', '対象施設の限定と認定要件を見直す前に、利用企業・非利用企業の投資を比較。目標未達の要因を需要不足と制度設計に分ける。', '対象・要件の見直し検討'),
  'mof-2024-r82': review(it, [
    { score: 2, reason: '情報通信産業の集積・生産性向上という目的と補助事業との役割分担を説明。税制の優位性は主に柔軟な適用という制度論による。', sources: [it] },
    { score: 1, reason: '立地企業数と労働生産性の実績を示すが、税制なしの比較対象はない。所得控除等を含む地域制度全体の評価であり、この投資税額控除単独の寄与は未分離。', sources: [it] },
    { score: 1, reason: '雇用者数に一人当たり生産額を乗じた経済効果と減収額を比較している。既存の生産を含み、税制による追加的な純便益ではないため、費用対効果の根拠としては弱い。', sources: [it] },
    { score: 2, reason: '対象業種・地域を設定し、認定要件の厳格さによる利用の少なさも説明される。対象を限定する利益と参入しにくさの比較が必要。', sources: [it] },
  ], '県調査による立地・生産性と、雇用者数から経済効果を求める計算方法を公開。因果推計としては加点しない。', '所得控除と税額控除を分離し、企業の総生産額ではなく、誘発された追加投資・生産性への寄与で再評価する。'),
  'mof-2024-r175': review(jobs, [
    { score: 2, reason: '地方の雇用創出と本社機能の分散という目的は明示。事前認定の仕組みもあるが、雇用控除単独を選ぶ優位性は限定的な説明に留まる。', sources: [jobs] },
    { score: 1, reason: '認定企業への調査と制度創設前後の比較による寄与推計がある。ただしオフィス減税も含む制度全体の評価であり、雇用促進税額控除単独の効果を分離していない。', sources: [jobs] },
    { score: null, reason: '評価書の経済波及効果はオフィス整備への投資を基礎とする。これを雇用促進税額控除だけの費用と対比できないため、雇用1人当たりの追加的費用は判定保留。', sources: [jobs] },
    { score: 2, reason: '規模・業種を限定せず認定計画に基づいて適用する一方、赤字や要件未達による利用断念も報告。公平な利用可能性には課題が残る。', sources: [jobs] },
  ], '認定企業への調査、創設前後比較、推計手順が公開。ただし他の税制との効果分離はない。', 'オフィス減税と雇用控除を分け、地方移転・雇用増を誘発したかを検証。適用件数だけを増やすための要件緩和は避ける。'),
  'mof-2024-r118': review(carry, [
    { score: 2, reason: '独立した産業支援ではなく、沖縄の複数制度の控除限度超過額を後年度に使う仕組み。控除時期を調整する合理性はあるが、繰越期間等の最適性の裏付けは不足。', sources: [carry] },
    { score: null, reason: '元となる観光・情報通信等の投資税額控除と繰越部分の効果を切り分けた評価は確認できない。元制度の評価を転記すると二重評価になるため保留。', sources: [carry, tourism, it] },
    { score: null, reason: '当年度の繰越控除額は分かるが、過年度の投資と対応する追加的便益・税収の時点差を結びつける資料が不足。', sources: [carry] },
    { score: 2, reason: '当期の法人税額の20%という上限は明確。将来の税負担がある法人が利用できる仕組みであり、継続的な赤字企業との支援差は残る。', sources: [carry] },
  ], null, '繰越発生年度・元の制度・利用年度を対応づける集計を求める。元制度の追加投資と繰越利用を重複計上せず評価する。'),
};
