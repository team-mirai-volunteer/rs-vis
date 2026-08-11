'use client';

/**
 * 品質スコア詳細の表示メタ情報（軸の文言・重み・バッジ・支出先ステータス）。
 * /quality の一覧とスコア詳細ダイアログ（ScoreDetailDialog）で同じ文言を使い回す。
 * 重複定義を置かないこと。
 */

import {
  RECOMMENDATION_ORDER,
  IMPROVEMENT_ACTION_ORDER,
  type PolicyEvaluation,
  type PolicyRecommendationTone,
} from '@/app/lib/policy-evaluation';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';

/** 一覧に出す政策評価の指標（品質軸の生値は詳細側に集約した） */
export type PolicyMetric = 'overallScore' | 'designClarityScore' | 'evidenceScore'
  | 'executionTransparency' | 'proportionalityScore' | 'necessityScore';

/**
 * 5軸の表示名・重み・説明。一覧のヘッダ、足きりのラベル、モーダルで同じ文言を使い回す。
 * desc は title 属性にそのまま出すので、何を材料に何を判定しているかまで書く。
 */
export const AXIS_META: { key: PolicyMetric; label: string; weight: number; short: string; desc: string }[] = [
  {
    key: 'designClarityScore', label: '成果設計', weight: 15, short: '設計',
    desc: `誰のどんな課題を、どの活動で、どう改善するのかが、特定できる形で説明されているか。

材料は事業概要の文章と、RSシステムに登録されたロジックモデル（活動→アウトプット→アウトカムの接続）の両方です。
実際に成果が出たかではなく、成果への道筋が設計されているかを見ています。
接続が未登録・浅い事業は、概要文が整っていても低くなります。`,
  },
  {
    key: 'evidenceScore', label: '検証可能性', weight: 15, short: '検証',
    desc: `成果が出たかどうかを、第三者が後から確かめられる状態か。

材料は登録された成果指標（目標値・実績値・出典の有無）と、概要文中の数値記述の両方です。
指標が登録されていても実績値や出典が無ければ検証できないため低くなります。
逆に概要文に数値が無くても、登録指標に実績と出典があれば評価されます。`,
  },
  {
    key: 'executionTransparency', label: '執行透明性', weight: 15, short: '透明',
    desc: `払った先が誰で、何に使ったのかを説明できるか。支出先データから算出します。

= 支出先の明確さ×55 ＋ 使途の説明×45

「収支の一致」は9割の事業が満点でほぼ定数だったため、この平均には入れず、
不一致（60点未満）のときだけフラグとして拾っています。
支出先データが1行も無い事業は未評価（0点扱いにはしません）。`,
  },
  {
    key: 'proportionalityScore', label: '費用対内容', weight: 35, short: '費用',
    desc: `金額が活動の規模に見合っているか、金が実際に受益者へ届いているか。

材料は支出先・再委託の実データです。所管庁の作文では動かしにくい軸なので、5軸で最も重く置いています。
数量や単価が示されず金額に換算できない事業、支出が調査・助言業者に集中している事業は低くなります。
金額の大小そのものではなく、根拠が示されているかで判定します。
予算額が0の事業などは判定対象外（未評価）です。`,
  },
  {
    key: 'necessityScore', label: '必要性', weight: 20, short: '必要',
    desc: `この事業を廃止したら誰が具体的に困るか、その手当ては他の手段で代替できるか。

設計の巧拙とは切り離して「そもそも要るのか」だけを問う軸です。
よく書けた事業計画でも、困る主体を特定できず代替手段もあるなら低くなります。
逆に説明が粗くても、廃止したときの不利益が具体的なら高くなります。`,
  },
];

/** 総合点・金額系・その他の列の説明。AXIS_META と同じく title にそのまま出す */
export const COL_DESC: Record<string, string> = {
  総合点: `5軸の加重平均（0-100）。

成果設計×15 ＋ 検証可能性×15 ＋ 執行透明性×15 ＋ 費用対内容×35 ＋ 必要性×20

未評価の軸は、その重みごと除外して残りで再正規化します（0点扱いにはしません）。
不用額は総合点に算入していません。返納は適切な行動であり、減点すると年度末の使い切りを誘発するためです。`,

  推奨: `継続 / 要改善 / 条件付き継続 / 縮小 / 再設計 / 終了・廃止候補 のいずれか。

総合点の絶対値ではなく、母集団内の順位帯で切っています。
総合点は中央に強く偏るため、絶対値で閾値を置くと下位の帯が構造的に空になるからです。
「縮小」だけは点数ではなく、2年連続の不用額から判定します。

これは結論ではなく、人が精査すべき事業を絞り込むためのスクリーニング結果です。`,

  改善アクション: `次に打つ一手を1つだけ提示します。

支出先が特定できない状態では成果の検証も設計の議論も成立しないため、
情報開示・ガバナンス改善を、成果検証やKPI改善より先に置いています。`,

  予算額: `歳出予算現額の合計（当初予算＋補正＋前年度繰越など）。
2-1 CSV の「計(歳出予算現額合計)」から取得しています。`,

  執行額: `実際に支出した額。2-1 CSV の「執行額(合計)」。

予算額との差が不用額です。不用額は総合点には影響しません。`,

  支出先合計: `支出先データ（5-1）の金額を単純に合計したもの。

国→A社 の支出と A社→B社 の再委託が同じ形式で並んでいるため、同じ金が二重に数えられています。
実額を見るときは「実質支出額」を使ってください。`,

  実質支出額: `再委託を除いた、国から直接出た金額。

支出ブロック関係（5-2）で、ルートブロック＝担当組織からの直接支出だけを合算しています。
例）国→A社10億、A社→B社6億 のとき、支出先合計18億 に対して実質支出額は10億。

執行額とこの額の乖離が「収支の一致」の判定材料です。
5-2 データが無い事業は再委託の情報自体が無いため、全額をルート扱いにしています。`,

  再委託階層: `支出の連鎖の深さ。国→A社→B社 なら 2。

深いほど、最終的に誰が受け取ったのかを追いにくくなります。`,

  支出先数: `支出先データに登場する支出先の件数。`,

  PID: `RSシステムの事業ID。行政事業レビューシートの事業単位に対応します。`,
  事業名: `行政事業レビューシート上の事業名。クリックで内訳を展開します。`,
  府省庁: `事業を所管する府省庁。`,
  組織: `局・庁までの所管組織。詳細な階層（課・室まで）はモーダルのヘッダに出ます。`,
  支出先列: `クリックすると支出先一覧・事業内容・スコアの計算根拠をモーダルで開きます。`,

  継続年数: `対象年度 − 開始年度 ＋ 1。★は終了予定なしの事業。

20年以上をオレンジで表示しています。開始年度が未登録の事業は — になります。`,
};


export type SortField = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisStructure' | 'axisEffective'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name'
  | 'yearsRunning' | PolicyMetric | 'recommendation' | 'improvementAction';
export type SortDir = 'asc' | 'desc';

/** 推奨判断バッジの配色（/quality のライト/ダーク両対応トーンに合わせる） */
export const TONE_CLS: Record<PolicyRecommendationTone, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  blue:  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  red:   'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export const ACTION_CLS = 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200';

/** 不用の傾向の表示文言。前年度と突き合わせた結果を明示する */
export const UNUSED_TREND_META: Record<PolicyEvaluation['unusedTrend'], { label: string; cls: string }> = {
  persistent: { label: '2年連続で不用率が上位帯（構造的な計上過大）', cls: 'text-orange-600 dark:text-orange-400' },
  single:     { label: '当年度のみ不用が大きい（前年度は正常水準）',   cls: 'text-amber-600 dark:text-amber-400' },
  unknown:    { label: '当年度の不用は大きいが前年度実績が無く判定不能', cls: 'text-gray-500 dark:text-gray-400' },
  normal:     { label: '不用率は上位帯に達していない',               cls: 'text-gray-400' },
};

/**
 * 一覧テーブルの固定列幅（table-fixed 用）。
 * ソートやフィルタで中身が変わっても列位置が動かないよう、内容に依存しない幅を持たせる。
 * 順序は thead / tbody のセル順と一致させること。
 */
export const COL_WIDTHS = [
  56,  // PID
  300, // 事業名
  92,  // 府省庁
  120, // 局・庁
  56,  // 支出先（詳細ボタン）
  66,  // 総合点
  62,  // 成果設計
  74,  // 検証可能性
  74,  // 執行透明性
  74,  // 費用対内容
  58,  // 必要性
  120, // 推奨（2年連続の不用マーカーを含む）
  112, // 改善アクション
  64,  // 継続年数
  78,  // 予算額
  78,  // 執行額
  90,  // 支出先合計
  90,  // 実質支出額
  72,  // 再委託階層
  70,  // 支出先数
];

/**
 * AI採点の生値（0-10）の表示。k投票（--votes）を有効にすると軸ごとの平均が入って
 * 小数になるため、整数のときは整数のまま、小数のときだけ1桁に丸める。
 */
export function fmtRaw(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export const WEIGHT_BY_KEY = Object.fromEntries(AXIS_META.map(a => [a.key, a.weight])) as Record<PolicyMetric, number>;

export const RECOMMENDATION_LABELS = Object.keys(RECOMMENDATION_ORDER);
export const IMPROVEMENT_ACTION_LABELS = Object.keys(IMPROVEMENT_ACTION_ORDER);

export function RecommendationBadge({ policy }: { policy: PolicyEvaluation }) {
  if (!policy.recommendation || !policy.recommendationTone) {
    return <span className="text-gray-300 dark:text-gray-600">—</span>;
  }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${TONE_CLS[policy.recommendationTone]}`}>
      {policy.recommendation}
    </span>
  );
}

/**
 * 2年連続で不用率が上位帯にある事業のマーカー。
 * 単年度の入札差金では説明できない構造的な計上過大を、一覧で識別できるようにする。
 */
export function PersistentUnusedMark({ policy }: { policy: PolicyEvaluation }) {
  if (policy.unusedTrend !== 'persistent') return null;
  const prior = policy.priorUnusedRatio != null ? Math.round(policy.priorUnusedRatio * 100) : '—';
  const current = policy.unusedRatio != null ? Math.round(policy.unusedRatio * 100) : '—';
  return (
    <span
      className="inline-block mt-0.5 px-1 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
      title={`前年度の不用率 ${prior}% → 当年度 ${current}%。2年連続で母集団の上位帯にあります`}
    >
      2年連続の不用
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${ACTION_CLS}`}>
      {action}
    </span>
  );
}

export const STATUS_META: Record<RecipientRow['s'], { label: string; cls: string }> = {
  valid:   { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  gov:     { label: '行政機関', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  supp:    { label: '補助辞書', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  // 番号一致(houjin.db裏取り)も表示上は valid と同格の OK に統合（内部 s='cn' と cnVerifiedCount は集計用に保持）
  cn:      { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  invalid: { label: '不一致',  cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  unknown: { label: '未登録',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};
