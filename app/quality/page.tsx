'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import type { RecipientRow } from '@/app/api/quality-scores/recipients/route';
import type { ExecutionHistoryResponse } from '@/app/api/execution-history/route';
import type { ProjectDetail } from '@/types/project-details';
import {
  buildPolicyEvaluations,
  POLICY_CATEGORY_GROUPS,
  IMPROVEMENT_ACTION_ORDER,
  RECOMMENDATION_ORDER,
  type PolicyEvaluation,
  type PolicyRecommendationTone,
} from '@/app/lib/policy-evaluation';

const PAGE_SIZE = 50;

/** 一覧に出す政策評価の指標（品質軸の生値は詳細側に集約した） */
type PolicyMetric = 'overallScore' | 'designClarityScore' | 'evidenceScore'
  | 'executionTransparency' | 'proportionalityScore' | 'necessityScore';

/**
 * 5軸の表示名・重み・説明。一覧のヘッダ、足きりのラベル、モーダルで同じ文言を使い回す。
 * desc は title 属性にそのまま出すので、何を材料に何を判定しているかまで書く。
 */
const AXIS_META: { key: PolicyMetric; label: string; weight: number; short: string; desc: string }[] = [
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
const COL_DESC: Record<string, string> = {
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


type SortField = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisStructure' | 'axisEffective'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name'
  | 'yearsRunning' | PolicyMetric | 'recommendation' | 'improvementAction';
type SortDir = 'asc' | 'desc';

/** 推奨判断バッジの配色（/quality のライト/ダーク両対応トーンに合わせる） */
const TONE_CLS: Record<PolicyRecommendationTone, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  blue:  'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  red:   'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const ACTION_CLS = 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200';

/** 不用の傾向の表示文言。前年度と突き合わせた結果を明示する */
const UNUSED_TREND_META: Record<PolicyEvaluation['unusedTrend'], { label: string; cls: string }> = {
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
const COL_WIDTHS = [
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
function fmtRaw(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const WEIGHT_BY_KEY = Object.fromEntries(AXIS_META.map(a => [a.key, a.weight])) as Record<PolicyMetric, number>;

const RECOMMENDATION_LABELS = Object.keys(RECOMMENDATION_ORDER);
const IMPROVEMENT_ACTION_LABELS = Object.keys(IMPROVEMENT_ACTION_ORDER);

function RecommendationBadge({ policy }: { policy: PolicyEvaluation }) {
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
function PersistentUnusedMark({ policy }: { policy: PolicyEvaluation }) {
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

function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${ACTION_CLS}`}>
      {action}
    </span>
  );
}

const STATUS_META: Record<RecipientRow['s'], { label: string; cls: string }> = {
  valid:   { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  gov:     { label: '行政機関', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  supp:    { label: '補助辞書', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  invalid: { label: '不一致',  cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  unknown: { label: '未登録',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

/**
 * モーダルで引く支出先・事業内容のクライアントキャッシュ。
 * 同じ事業を開き直すたびに再取得していたため、モジュールスコープで保持する。
 * 進行中の Promise も入れて、同一事業への同時リクエストを1本にまとめる
 * （React StrictMode の二重実行や、閉じてすぐ開き直した場合の重複を防ぐ）。
 */
const recipientsCache = new Map<string, Promise<RecipientRow[]>>();
const projectInfoCache = new Map<string, Promise<ProjectDetail | null>>();

function fetchRecipients(pid: string, year: string): Promise<RecipientRow[]> {
  const key = `${year}-${pid}`;
  const hit = recipientsCache.get(key);
  if (hit) return hit;
  const req = fetch(`/api/quality-scores/recipients?pid=${pid}&year=${year}`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .catch(e => { recipientsCache.delete(key); throw e; });  // 失敗は残さず再試行可能にする
  recipientsCache.set(key, req);
  return req;
}

function fetchProjectInfo(pid: string, year: string): Promise<ProjectDetail | null> {
  const key = `${year}-${pid}`;
  const hit = projectInfoCache.get(key);
  if (hit) return hit;
  const req = fetch(`/api/project-details/${pid}?year=${year}`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
  projectInfoCache.set(key, req);
  return req;
}

function ScoreDetailDialog({ item, policy, onClose, year }: { item: QualityScoreItem; policy: PolicyEvaluation | undefined; onClose: () => void; year: string }) {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a2' | 'pct'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);
  const [showPolicy, setShowPolicy] = useState(true);
  const [projectInfo, setProjectInfo] = useState<ProjectDetail | null | undefined>(undefined);
  const [showProjectInfo, setShowProjectInfo] = useState(true);
  const COL_MAX_WIDTHS = [undefined, 70, 64, 60, 50, undefined, undefined];
  const [colWidths, setColWidths] = useState<number[]>([200, 70, 64, 60, 50, 200, 200]);
  const resizingCol = useRef<{ index: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const { index, startX, startW } = resizingCol.current;
      const maxW = COL_MAX_WIDTHS[index];
      const newW = Math.min(maxW ?? Infinity, Math.max(40, startW + e.clientX - startX));
      setColWidths(prev => { const next = [...prev]; next[index] = newW; return next; });
    };
    const onMouseUp = () => { resizingCol.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  // Escape で閉じる（モーダルとしての基本挙動）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setRecipients(null);
    setRecipientsError(false);
    setRecipientSearch('');
    setRecipientSortField('chain');
    setRecipientSortDir('asc');
    setShowAxisDetail(false);
    setShowPolicy(true);
    setProjectInfo(undefined);
    setShowProjectInfo(true);
    // 表示中の事業が切り替わった後に古い応答が届いても反映しない
    let stale = false;
    fetchRecipients(item.pid, year)
      .then(rows => { if (!stale) setRecipients(rows); })
      .catch(() => { if (!stale) setRecipientsError(true); });
    fetchProjectInfo(item.pid, year)
      .then(d => { if (!stale) setProjectInfo(d); });
    return () => { stale = true; };
  }, [item.pid, year]);

  const displayedRecipients = useMemo(() => {
    if (!recipients) return [];
    let rows = recipients;
    if (recipientSearch.trim()) {
      const q = recipientSearch.trim().toLowerCase();
      rows = rows.filter(r => r.n.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (recipientSortField === 'chain') cmp = (a.chain ?? a.b).localeCompare(b.chain ?? b.b) || (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 'b') cmp = a.b.localeCompare(b.b) || (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 's') cmp = a.s.localeCompare(b.s);
      else if (recipientSortField === 'c') cmp = (b.c ? 1 : 0) - (a.c ? 1 : 0);
      else if (recipientSortField === 'o') cmp = (b.o ? 1 : 0) - (a.o ? 1 : 0);
      else if (recipientSortField === 'a2') cmp = (b.a2 ?? -1) - (a.a2 ?? -1);
      else if (recipientSortField === 'pct') {
        const net = item.spendNetTotal || 1;
        const ap = a.a2 !== null && a.a2 > 0 ? a.a2 / net : -1;
        const bp = b.a2 !== null && b.a2 > 0 ? b.a2 / net : -1;
        cmp = bp - ap;
      }
      return recipientSortDir === 'desc' ? -cmp : cmp;
    });
  }, [recipients, recipientSearch, recipientSortField, recipientSortDir]);

  function handleRecipientSort(field: typeof recipientSortField) {
    if (recipientSortField === field) {
      setRecipientSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setRecipientSortField(field);
      setRecipientSortDir(field === 'a2' || field === 'pct' ? 'desc' : 'asc');
    }
  }

  const isAi = !!item.aiSource && item.aiSource !== 'heuristic';

  const axis1Total = item.validCount + item.govAgencyCount + item.suppValidCount + item.invalidCount;
  const axis1Num = item.validCount + item.govAgencyCount + item.suppValidCount;

  function RSortIcon({ field }: { field: typeof recipientSortField }) {
    if (recipientSortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-400 ml-0.5">{recipientSortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} の詳細`}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-8xl mx-4 max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3 shrink-0 bg-gray-50 dark:bg-gray-800 rounded-t-2xl">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-900 dark:text-white leading-snug">{item.name}</div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="font-mono bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">PID {item.pid}</span>
              {[item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).map((org, i) => (
                <span key={i}>{i > 0 ? '' : ''}<span className={i === 0 ? 'font-medium' : ''}>{org}</span>{i < [item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).length - 1 ? <span className="text-gray-300 dark:text-gray-600 mx-0.5">›</span> : null}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="閉じる（Esc）" title="閉じる（Esc）" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">×</button>
        </div>

        {/* Score summary — single compact row */}
        <div className="px-6 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-4">
            <div className="shrink-0 text-center">
              <div className={`text-2xl font-bold font-mono leading-none cursor-help ${scoreColor(policy?.overallScore ?? null)}`} title={COL_DESC.総合点}>
                {policy?.overallScore ?? '—'}
              </div>
              <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">総合点</div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {AXIS_META.map(a => {
                const score = policy?.[a.key] ?? null;
                return (
                  <div key={a.key} className="text-center cursor-help" title={`${a.label}（総合点への重み ${a.weight}）

${a.desc}`}>
                    <div className={`text-sm font-bold font-mono leading-none ${scoreColor(score)}`}>
                      {score ?? '—'}
                    </div>
                    <div className="text-[9px] text-gray-400 mt-0.5 whitespace-nowrap">{a.label}</div>
                  </div>
                );
              })}
            </div>
            {/* Divider */}
            <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 shrink-0" />
            {/* Key metrics — 3 lines inline */}
            <div className="flex-1 min-w-0 text-[10px] text-gray-700 dark:text-gray-200 space-y-0.5">
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-gray-400">予算:</span><span className="font-mono">{formatAmount(item.budgetAmount)}</span></span>
                <span><span className="text-gray-400">執行:</span><span className="font-mono">{formatAmount(item.execAmount)}</span></span>
                <span><span className="text-gray-400">実質支出:</span><span className="font-mono">{formatAmount(item.spendNetTotal)}</span></span>
                <span><span className="text-gray-400">乖離率:</span><span className="font-mono">{pct(item.gapRatio)}</span></span>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-gray-400">支出先数:</span><span className="font-mono">{recipients?.length ?? '...'}</span></span>
                <span><span className="text-gray-400">ブロック:</span>{item.blockCount}件</span>
                {item.hasRedelegation && <span><span className="text-gray-400">深度:</span><span className="text-orange-500">{item.redelegationDepth}</span></span>}
                {item.opaqueRatio !== null && item.opaqueRatio > 0 && <span><span className="text-gray-400">不透明:</span><span className="text-amber-500">{pct(item.opaqueRatio)}</span></span>}
              </div>
              <div className="flex flex-wrap gap-x-3 items-center">
                {item.identifyLevelAvg != null && <span><span className="text-gray-400">特定Lv</span> <span className="font-mono">{item.identifyLevelAvg.toFixed(1)}/3</span></span>}
                {item.purposeLevelAvg != null && <span><span className="text-gray-400">使途Lv</span> <span className="font-mono">{item.purposeLevelAvg.toFixed(1)}/3</span></span>}
                <span><span className="text-gray-400">valid</span> <span className="font-mono">{axis1Num}/{axis1Total}</span></span>
                <span><span className="text-gray-400">法人番号</span> <span className="font-mono">{item.cnFilled}/{item.cnFilled + item.cnEmpty}</span></span>
                {item.aiSource && (
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${isAi ? 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`} title={item.aiSource}>
                    {isAi ? 'AI評価' : 'ヒューリスティック'}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* 何を評価した結果なのかを先に読めるよう、事業内容 → 政策評価 → 計算根拠 の順に並べる */}
          <div className="mt-1 flex items-center gap-4">
            <button
              onClick={() => setShowProjectInfo(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showProjectInfo ? '▲ 事業内容を閉じる' : '▼ 事業内容'}
            </button>
            {policy && (
              <button
                onClick={() => setShowPolicy(d => !d)}
                className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
              >
                {showPolicy ? '▲ 政策評価を閉じる' : '▼ 政策評価'}
              </button>
            )}
            <button
              onClick={() => setShowAxisDetail(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showAxisDetail ? '▲ 計算根拠を閉じる' : '▼ スコア計算根拠'}
            </button>
          </div>
        </div>

        {/*
          ここから下はモーダル内で唯一のスクロール領域。
          以前は各セクションが個別に max-h + overflow-y-auto を持っていて、
          モーダル自身のスクロールと二重になり、どこを掴んでいるのか分からなくなっていた。
        */}
        <div className="flex-1 min-h-0 overflow-y-auto">

        {/* 事業内容（目的・現状課題・概要）— 成果設計の判定材料 */}
        {showProjectInfo && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
            {projectInfo === undefined && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="animate-spin h-3 w-3 border border-gray-400 border-t-transparent rounded-full" />
                事業内容を読み込み中...
              </div>
            )}
            {projectInfo === null && <div className="text-xs text-gray-400">事業内容データなし</div>}
            {projectInfo && (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                  {projectInfo.category && <span>区分: {projectInfo.category}</span>}
                  {projectInfo.startYear && <span>開始: {projectInfo.startYear}年度</span>}
                  <span>終了: {projectInfo.noEndDate ? '予定なし' : (projectInfo.endYear ? `${projectInfo.endYear}年度` : '-')}</span>
                  {projectInfo.implementationMethods?.length > 0 && <span>実施方法: {projectInfo.implementationMethods.join('・')}</span>}
                  {projectInfo.url && <a href={projectInfo.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">事業概要URL ↗</a>}
                </div>
                {([
                  { label: '目的', text: projectInfo.purpose },
                  { label: '現状・課題', text: projectInfo.currentIssues },
                  { label: '概要', text: projectInfo.overview },
                ] as const).map(({ label, text }) => text ? (
                  <div key={label}>
                    <div className="font-semibold text-gray-700 dark:text-gray-300">{label}</div>
                    <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{text.replace(/\//g, '\n')}</div>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* 政策評価 — 推奨判断・改善アクションとその根拠 */}
        {policy && showPolicy && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-violet-50/50 dark:bg-violet-900/10">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <RecommendationBadge policy={policy} />
                {policy.improvementAction && <ActionBadge action={policy.improvementAction} />}
                {policy.policyCategoryLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {policy.policyCategoryLabel}
                  </span>
                )}
                {policy.overallPercentile != null && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    母集団内 上位{(100 - policy.overallPercentile).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 grid gap-3 sm:grid-cols-3 text-xs">
              <div>
                <div className="font-semibold text-gray-700 dark:text-gray-300">AI評価の生値（0-10）</div>
                <div className="mt-0.5 space-y-0.5 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  <div>成果設計: {fmtRaw(policy.designClarity)}/10</div>
                  <div>検証可能性: {policy.evidenceReadiness != null ? `${fmtRaw(policy.evidenceReadiness)}/10` : '未評価'}</div>
                  <div>費用対内容: {policy.budgetProportionality != null ? `${fmtRaw(policy.budgetProportionality)}/10` : '未評価'}</div>
                  <div>必要性: {policy.necessity != null ? `${fmtRaw(policy.necessity)}/10` : '未評価'}</div>
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-700 dark:text-gray-300">執行透明性の内訳</div>
                <div className="mt-0.5 space-y-0.5 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  <div>支出先の明確さ: {policy.identifiability ?? '—'}</div>
                  <div>使途の説明: {policy.purposeExplainability ?? '—'}</div>
                  <div className="text-gray-400">
                    収支の一致: {policy.budgetConsistency ?? '—'}（不算入・不一致フラグ）
                  </div>
                </div>
              </div>
              <div>
                <div className="font-semibold text-gray-700 dark:text-gray-300">
                  予算と執行
                  <span className="ml-1 font-normal text-gray-400">（総合点には不算入）</span>
                </div>
                <div className="mt-0.5 space-y-0.5 text-gray-600 dark:text-gray-400 font-mono text-[11px]">
                  {policy.executionRate != null ? (
                    <>
                      <div>執行率: {Math.round(policy.executionRate * 100)}%</div>
                      <div>
                        不用額: {policy.unusedAmount ? formatAmount(policy.unusedAmount) : '0'}
                        {policy.unusedRatio != null && `（${Math.round(policy.unusedRatio * 100)}%）`}
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-400">執行実績なし（予備的経費・未着手のため評価対象外）</div>
                  )}
                  {policy.priorExecutionRate != null ? (
                    <div className="text-gray-500 dark:text-gray-400">
                      前年度: 執行率 {Math.round(policy.priorExecutionRate * 100)}%・
                      不用率 {Math.round((policy.priorUnusedRatio ?? 0) * 100)}%
                    </div>
                  ) : (
                    <div className="text-gray-400">前年度: 実績なし（傾向は判定不能）</div>
                  )}
                  <div className={`font-sans ${UNUSED_TREND_META[policy.unusedTrend].cls}`}>
                    {UNUSED_TREND_META[policy.unusedTrend].label}
                  </div>
                  {policy.spendDownRisk && (
                    <div className="text-amber-600 dark:text-amber-400 font-sans">
                      ほぼ消化済だが支出先が不透明
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2 space-y-1.5 text-xs">
              {/* 軸ごとの判定理由。総合点だけでは「なぜ低いのか」が追えないため4軸を並べる */}
              {([
                { label: '成果設計', text: policy.findings.design },
                { label: '検証可能性', text: policy.findings.evidence },
                { label: '費用対内容', text: policy.findings.proportionality },
                { label: '必要性', text: policy.findings.necessity },
              ] as const).map(({ label, text }) => text ? (
                <div key={label}>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{label}: </span>
                  <span className="text-gray-600 dark:text-gray-300 leading-relaxed">{text}</span>
                </div>
              ) : null)}
              {policy.recommendationReason && (
                <div>
                  <span className="font-semibold text-gray-700 dark:text-gray-300">推奨理由: </span>
                  <span className="text-gray-600 dark:text-gray-300 leading-relaxed">{policy.recommendationReason}</span>
                </div>
              )}
              <div className="text-[10px] leading-4 text-amber-700 dark:text-amber-300/80">{policy.provisionalReason}</div>
            </div>
          </div>
        )}

        {/* Axis detail (collapsible) */}
        {showAxisDetail && (
          <div className="border-b border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
            <div className="px-5 py-1.5 bg-violet-50/60 dark:bg-violet-900/20 text-[11px] text-gray-500 dark:text-gray-400">
              欠測した項目は重みごと除外して再正規化します（0点扱いにはしません）。
            </div>

            {/* AI が判定する4軸 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                AI が判定する4軸（0-10 → 10倍して0-100点）
                {isAi ? "" : <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">この事業はヒューリスティック判定です</span>}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">成果設計</span>
                  <span className="ml-1 text-gray-400">重み{WEIGHT_BY_KEY.designClarityScore}</span>:
                  誰のどんな課題をどの活動でどう改善するかが、概要文と登録されたロジックモデルの両方から特定できるか（実測成果ではない）
                  <div className="font-mono text-gray-400">
                    {fmtRaw(policy?.designClarity)}/10 → {policy?.designClarityScore ?? "—"}点
                  </div>
                  {policy?.findings.design && <div className="leading-relaxed">{policy.findings.design}</div>}
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">検証可能性</span>
                  <span className="ml-1 text-gray-400">重み{WEIGHT_BY_KEY.evidenceScore}</span>:
                  成果を第三者が後から検証できるか。登録された成果指標（目標値・実績値・出典）と概要文の数値記述の両方を見る
                  <div className="font-mono text-gray-400">
                    {policy?.evidenceReadiness != null
                      ? `${fmtRaw(policy.evidenceReadiness)}/10 → ${policy.evidenceScore}点`
                      : "未評価（重みごと除外して再正規化。0点扱いにはしない）"}
                  </div>
                  {policy?.findings.evidence && <div className="leading-relaxed">{policy.findings.evidence}</div>}
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">費用対内容</span>
                  <span className="ml-1 text-gray-400">重み{WEIGHT_BY_KEY.proportionalityScore}</span>:
                  金額が活動の規模に見合い、金が受益者に届いているか。支出先・再委託の実データを判定材料にするため、
                  所管庁の作文では動かしにくい軸として最も重く置いている
                  <div className="font-mono text-gray-400">
                    {policy?.budgetProportionality != null
                      ? `${fmtRaw(policy.budgetProportionality)}/10 → ${policy.proportionalityScore}点`
                      : "未評価（予算額が0の事業などは判定対象外）"}
                  </div>
                  {policy?.findings.proportionality && <div className="leading-relaxed">{policy.findings.proportionality}</div>}
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">必要性</span>
                  <span className="ml-1 text-gray-400">重み{WEIGHT_BY_KEY.necessityScore}</span>:
                  廃止したら誰が具体的に困るか、その手当てを他の手段で代替できるか。設計の巧拙とは独立に「そもそも要るのか」を問う
                  <div className="font-mono text-gray-400">
                    {policy?.necessity != null ? `${fmtRaw(policy.necessity)}/10 → ${policy.necessityScore}点` : "未評価"}
                  </div>
                  {policy?.findings.necessity && <div className="leading-relaxed">{policy.findings.necessity}</div>}
                </div>
              </div>
            </div>

            {/* 執行透明性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                執行透明性 = 支出先の明確さ×55 + 使途の説明×45
                <span className="ml-1 font-normal text-gray-400">（総合点への重み{WEIGHT_BY_KEY.executionTransparency}）</span>
                <span className="ml-2 font-mono font-normal text-gray-400">= {policy?.executionTransparency ?? "—"}点</span>
                {policy && policy.executionTransparency === null && (
                  <span className="ml-2 font-normal text-amber-600 dark:text-amber-400">
                    支出先データが1行も無いため未評価（0点扱いにはしません）
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">支出先の明確さ</span>
                  {isAi ? "（AI判定）" : "（ヒューリスティック）"}: 支出先が具体的に誰で、第三者が実在を確認できるか
                  <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                    {item.identifyLevelAvg != null && <span>平均Lv {item.identifyLevelAvg.toFixed(2)}/3</span>}
                    <span className="text-green-600 dark:text-green-400">valid {item.validCount}</span>
                    {item.govAgencyCount > 0 && <span className="text-emerald-500">行政機関 {item.govAgencyCount}</span>}
                    {item.suppValidCount > 0 && <span className="text-blue-500">補助 {item.suppValidCount}</span>}
                    <span className="text-red-500">invalid {item.invalidCount}</span>
                    {item.opaqueRatio != null && item.opaqueRatio > 0 && <span className="text-amber-500">不透明 {pct(item.opaqueRatio)}</span>}
                    <span>= {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : "—"}点</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">使途の説明</span>: 役割・契約概要から「何にいくら使ったか」が理解・検証できるか
                  <div className="font-mono text-gray-400">
                    {item.purposeLevelAvg != null && <span className="mr-3">平均Lv {item.purposeLevelAvg.toFixed(2)}/3</span>}
                    <span>= {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : "—"}点</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium text-gray-600 dark:text-gray-300">収支の一致</span>（機械計算・
                  <span className="text-amber-600 dark:text-amber-400">執行透明性には不算入</span>）:
                  執行額と実質支出が一致しているか。実測で9割の事業が満点になりほぼ定数だったため、
                  加重平均から外して「不一致フラグ」（60点未満）として判定ルールが直接見る形に降格した。
                  <div className="font-mono text-gray-400">
                    執行 {formatAmount(item.execAmount)} vs 実質支出 {formatAmount(item.spendNetTotal)}
                    ／乖離 {pct(item.gapRatio)}（10%まで満点）
                    = {item.axisBudget != null ? item.axisBudget.toFixed(0) : "—"}点
                    {item.axisBudget != null && item.axisBudget < 60 && (
                      <span className="ml-2 text-red-500 font-sans">収支不一致</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 総合点 */}
            <div className="px-5 py-2.5 bg-gray-50 dark:bg-gray-800/60">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                総合点 = {AXIS_META.map(a => `${a.label}×${a.weight}`).join(" + ")}
              </div>
              <div className="text-xs font-mono text-gray-400">
                {AXIS_META.map(a => {
                  const v = policy?.[a.key];
                  return (
                    <span key={a.key} className={v == null ? "text-amber-600 dark:text-amber-400" : undefined}>
                      {v == null ? `（${a.label}は未評価のため除外）` : `${v}×${a.weight}`}
                      {a.key === "necessityScore" ? "" : " + "}
                    </span>
                  );
                })}
                {" "}= <span className={`font-bold ${scoreColor(policy?.overallScore ?? null)}`}>{policy?.overallScore ?? "—"}</span>点
                {policy?.overallPercentile != null && (
                  <span className="ml-2">／母集団内 上位{(100 - policy.overallPercentile).toFixed(0)}%（推奨はこの順位帯で判定）</span>
                )}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">
                費用対内容と必要性を厚くしているのは、この2軸だけが所管庁の作文が支配できない証拠
                （支出先の実績・予算執行）に基づくためです。よく書けた事業計画だけで上位に来ないようにしています。
              </div>
            </div>

            {/* 予算と執行（総合点に不算入） */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                予算と執行（総合点に不算入・縮小判定にのみ使用）
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="font-mono text-gray-400">
                  予算 {formatAmount(item.budgetAmount)} → 執行 {formatAmount(item.execAmount)}
                  {policy?.executionRate != null
                    ? `／執行率 ${Math.round(policy.executionRate * 100)}%・不用額 ${policy.unusedAmount ? formatAmount(policy.unusedAmount) : "0"}`
                    : "／執行実績なし（予備的経費・未着手のため評価対象外）"}
                </div>
                <div className="font-mono text-gray-400">
                  前年度: {policy?.priorExecutionRate != null
                    ? `執行率 ${Math.round(policy.priorExecutionRate * 100)}%・不用率 ${Math.round((policy.priorUnusedRatio ?? 0) * 100)}%`
                    : "実績なし（判定不能）"}
                  {policy && (
                    <span className={`ml-2 font-sans ${UNUSED_TREND_META[policy.unusedTrend].cls}`}>
                      {UNUSED_TREND_META[policy.unusedTrend].label}
                    </span>
                  )}
                </div>
                <div>
                  不用額の返納は適切な行動のため減点しません。見直すのは事業ではなく翌年度の計上額です。
                  単年度の不用は入札差金でも発生するため、「縮小」は2年連続で不用率が上位帯にある場合に限っています。
                  前年度の実績が無い事業は判定不能として扱い、欠測を不利には扱いません。
                </div>
              </div>
            </div>

            {/* 参考: ブロック構造 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">ブロック構造（参考・スコアに不算入）</div>
              <div className="flex gap-3 flex-wrap text-xs font-mono text-gray-400">
                <span>ブロック数 {item.blockCount}</span>
                {item.orphanBlockCount > 0 && <span className="text-orange-500">孤立 {item.orphanBlockCount}</span>}
                {item.hasRedelegation && <span>再委託深度 {item.redelegationDepth}</span>}
                <span>整合スコア {item.axisStructure != null ? item.axisStructure.toFixed(0) : "—"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Recipients */}
        <div className="flex flex-col">
          <div className="px-6 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center gap-3">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                支出先一覧
                {recipients && (
                  <span className="ml-1.5 text-gray-400 font-normal font-mono">
                    {recipientSearch.trim() && displayedRecipients.length !== recipients.length
                      ? `${displayedRecipients.length} / ${recipients.length}件`
                      : `${recipients.length}件`}
                  </span>
                )}
              </div>
              {recipients && recipients.length > 0 && (
                <input
                  type="text"
                  placeholder="支出先名で検索..."
                  value={recipientSearch}
                  onChange={e => setRecipientSearch(e.target.value)}
                  className="flex-1 px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none"
                />
              )}
            </div>
          </div>

          {recipientsError && (
            <div className="px-6 py-4 text-xs text-gray-400">
              データを読み込めません（<code>python3 scripts/score-project-quality.py</code> を実行してください）
            </div>
          )}
          {!recipientsError && recipients === null && (
            <div className="px-6 py-4 flex items-center gap-2 text-xs text-gray-400">
              <div className="animate-spin h-3 w-3 border border-gray-400 border-t-transparent rounded-full" />
              読み込み中...
            </div>
          )}
          {recipients && recipients.length === 0 && (
            <div className="px-6 py-4 text-xs text-gray-400">支出先データなし</div>
          )}
          {recipients && recipients.length > 0 && (
            <div>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  {colWidths.map((w, i) => <col key={i} style={{ width: w, maxWidth: COL_MAX_WIDTHS[i] }} />)}
                </colgroup>
                <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
                  <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {([
                      { label: '支出先名', align: 'left', sort: null, title: undefined },
                      { label: '委託チェーン', align: 'left', sort: 'chain' as const, title: '委託チェーン（A→B→C）でソート' },
                      { label: '法人番号', align: 'center', sort: 'c' as const, title: '法人番号(Corporate Number)の記入有無' },
                      { label: '金額', align: 'right', sort: 'a2' as const, title: '個別支出額（CSVの「金額」列）' },
                      { label: '実支出比', align: 'right', sort: 'pct' as const, title: '実質支出合計に対する割合' },
                      { label: '役割', align: 'left', sort: null, title: '事業を行う上での役割（ブロック単位）' },
                      { label: '契約概要', align: 'left', sort: null, title: undefined },
                    ] as const).map((col, ci) => (
                      <th
                        key={ci}
                        className={`px-3 py-2 font-semibold whitespace-nowrap select-none relative ${col.sort ? 'cursor-pointer hover:text-gray-800 dark:hover:text-gray-200' : ''} text-${col.align}`}
                        onClick={col.sort ? () => handleRecipientSort(col.sort!) : undefined}
                        title={col.title}
                      >
                        <span className="truncate block overflow-hidden">{col.label}{col.sort && <RSortIcon field={col.sort} />}</span>
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-500 z-20"
                          onMouseDown={e => { e.preventDefault(); resizingCol.current = { index: ci, startX: e.clientX, startW: colWidths[ci] }; }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {displayedRecipients.map((row, i) => {
                    const sm = STATUS_META[row.s];
                    return (
                      <tr key={i} className="hover:bg-blue-50/50 dark:hover:bg-gray-800/60 transition-colors">
                        <td className="px-4 py-1.5 text-gray-800 dark:text-gray-200 font-medium" title={row.n}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate flex-1">{row.n}</span>
                            {!row.o && <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${sm.cls}`}>{sm.label}</span>}
                            {row.o && <span className="shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" title="不透明キーワードにマッチ">不透明</span>}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-gray-500 dark:text-gray-400 truncate" title={row.chain}>
                          {row.chain
                            ? (row.chain.startsWith('組織→') ? row.chain.slice('組織→'.length) : row.chain)
                            : (row.b || '-')}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {row.c
                            ? <span className="text-emerald-500 font-bold">✓</span>
                            : <span className="text-gray-300 dark:text-gray-600">—</span>
                          }
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {row.a2 === null ? <span className="text-gray-300 dark:text-gray-600">—</span> : formatAmount(row.a2)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-400 whitespace-nowrap">
                          {row.a2 !== null && row.a2 > 0 && item.spendNetTotal > 0
                            ? (() => { const p = row.a2 / item.spendNetTotal * 100; return p >= 1 ? `${p.toFixed(0)}%` : '<1%'; })()
                            : <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400 truncate" title={row.role || undefined}>
                          {row.role || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 truncate" title={row.cc || undefined}>
                          {row.cc || <span className="text-gray-300 dark:text-gray-600">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function formatAmount(yen: number): string {
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(2)}兆`;
  if (yen >= 1e8)  return `${(yen / 1e8).toFixed(1)}億`;
  if (yen >= 1e4)  return `${(yen / 1e4).toFixed(0)}万`;
  return yen.toLocaleString();
}

function pct(v: number | null): string {
  if (v === null) return '-';
  return `${(v * 100).toFixed(1)}%`;
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-400';
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 70) return 'text-blue-600 dark:text-blue-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function parseAmountInput(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/,/g, '');
  const match = trimmed.match(/^([\d.]+)\s*(兆|億|万|千)?円?$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  switch (match[2]) {
    case '兆': return value * 1e12;
    case '億': return value * 1e8;
    case '万': return value * 1e4;
    case '千': return value * 1e3;
    default: return value;
  }
}

/**
 * 金額フィルタの増減ラダー（1-2-5 系列）。
 * 金額は桁で効くので +1 ずつでは実用にならない。「1億 → 2億 → 5億 → 10億 …」で刻む。
 */
const AMOUNT_STEPS: number[] = (() => {
  const out: number[] = [];
  for (let e = 8; e <= 14; e += 1) for (const m of [1, 2, 5]) out.push(m * 10 ** e);
  return out;   // 1億 ~ 500兆
})();

/**
 * 表示用に整形。1000億以上は「兆」、それ未満は「億」。
 * 入力欄はスコア側と同じ50px幅に揃えているため「5000億」（6文字）は収まらない。
 * 1000億から兆表記に切り替えると「0.5兆」（4文字）で済み、parseAmountInput でも読み戻せる。
 */
function formatAmountInput(yen: number): string {
  if (yen >= 1e11) {
    const v = yen / 1e12;
    return `${Number.isInteger(v) ? v : v.toFixed(1)}兆`;
  }
  const v = yen / 1e8;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}億`;
}

/** 金額を1段上げ下げする。空欄からは最小値へ、最小値を下回ると空欄へ戻る */
function stepAmount(current: string, dir: 1 | -1): string {
  const now = parseAmountInput(current);
  if (now === null) return dir > 0 ? formatAmountInput(AMOUNT_STEPS[0]) : '';
  const next = dir > 0
    ? AMOUNT_STEPS.find((s) => s > now)
    : [...AMOUNT_STEPS].reverse().find((s) => s < now);
  if (next === undefined) return dir > 0 ? formatAmountInput(AMOUNT_STEPS[AMOUNT_STEPS.length - 1]) : '';
  return formatAmountInput(next);
}

/** 0-100 のスコアを step 刻みで上げ下げする。0 未満に下げると空欄へ戻る */
function stepScore(current: string, dir: 1 | -1, max = 100, step = 10): string {
  const now = current.trim() === '' ? null : Number(current);
  if (now === null || Number.isNaN(now)) return dir > 0 ? '0' : '';
  const next = Math.round(now / step) * step + dir * step;
  if (next < 0) return '';
  return String(Math.min(max, next));
}

/**
 * 範囲フィルタの入力欄。金額（単位付きテキスト）とスコア（数値）で見た目と操作を揃える。
 *
 * 金額欄は「1兆」「100億」を受けるため type="number" にできず、ブラウザ標準のスピナーが出ない。
 * 一方スコア欄の標準スピナーは幅を食ってプレースホルダを潰す。
 * そこで両方とも標準スピナーを消し、同じ ▲▼ を入力ボックスの内側に重ねる。
 */
function RangeStepInput({ value, onChange, onStep, placeholder, title, width }: {
  value: string;
  onChange: (v: string) => void;
  onStep: (current: string, dir: 1 | -1) => string;
  placeholder: string;
  title: string;
  width: number;
}) {
  const btn = 'block h-[9px] leading-[8px] w-3 text-[7px] text-gray-400 '
    + 'hover:text-gray-800 dark:hover:text-gray-100';
  return (
    <span className="relative inline-block shrink-0" style={{ width }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        title={`${title}　▲▼またはキーボードの↑↓で増減できます`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          onChange(onStep(value, e.key === 'ArrowUp' ? 1 : -1));
        }}
        className="w-full pl-1 pr-3 py-0.5 border border-gray-300 dark:border-gray-600 rounded
          bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
      />
      <span className="absolute right-px top-1/2 -translate-y-1/2 flex flex-col select-none">
        <button type="button" tabIndex={-1} className={btn} title="1段上げる"
          onClick={() => onChange(onStep(value, 1))}>▲</button>
        <button type="button" tabIndex={-1} className={btn} title="1段下げる"
          onClick={() => onChange(onStep(value, -1))}>▼</button>
      </span>
    </span>
  );
}

type ScoreRange = 'all' | '0-9' | '10-19' | '20-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70-79' | '80-89' | '90-99' | '100-100';

type DistMetric = PolicyMetric | 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisEffective';
const DIST_METRICS: { key: DistMetric; label: string }[] = [
  { key: 'overallScore', label: '総合点' },
  ...AXIS_META.map(a => ({ key: a.key as DistMetric, label: a.label })),
  { key: 'axisIdentify', label: '支出先の明確さ' },
  { key: 'axisPurpose', label: '使途の説明' },
  { key: 'axisBudget', label: '収支の一致' },
];

const POLICY_METRICS: readonly DistMetric[] = ['overallScore', ...AXIS_META.map(a => a.key)];

/** 足きり入力の初期値（全指標が空欄＝無制限） */
const EMPTY_SCORE_FILTERS = (): Record<PolicyMetric, { min: string; max: string }> =>
  Object.fromEntries(
    (POLICY_METRICS as PolicyMetric[]).map(k => [k, { min: '', max: '' }]),
  ) as Record<PolicyMetric, { min: string; max: string }>;

export default function QualityPage() {
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  const [data, setData] = useState<QualityScoresResponse | null>(null);
  const [history, setHistory] = useState<ExecutionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sankey 等から ?pid= で特定事業を指すことがある。初期表示だけ検索欄へ流し込む
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('pid') ?? '';
  });
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all');
  const [selectedRecommendation, setSelectedRecommendation] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [distMetric, setDistMetric] = useState<DistMetric>('overallScore');
  const [showGuide, setShowGuide] = useState(false);
  // 政策指標の足きり（下限/上限）。空欄は無制限
  const [scoreFilters, setScoreFilters] = useState(EMPTY_SCORE_FILTERS);
  /** 継続年数の足きり。0-100 のスコアではないので scoreFilters とは別に持つ */
  const [yearsFilter, setYearsFilter] = useState({ min: '', max: '' });
  const [amountFilters, setAmountFilters] = useState<Record<string, { min: string; max: string }>>({
    budgetAmount: { min: '', max: '' },
    execAmount: { min: '', max: '' },
    spendTotal: { min: '', max: '' },
    spendNetTotal: { min: '', max: '' },
  });
  const [sortField, setSortField] = useState<SortField>('spendNetTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  /** ページを送ったら表の先頭に戻す。下端で押したとき次ページの末尾が見える状態を避ける */
  function goToPage(next: number) {
    setPage(next);
    tableScrollRef.current?.scrollTo({ top: 0 });
    tableScrollRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [dialogItem, setDialogItem] = useState<QualityScoreItem | null>(null);

  useEffect(() => {
    setData(null);
    setLoading(true);
    setError(null);
    setSelectedMinistry('');
    fetch(`/api/quality-scores?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((json: QualityScoresResponse) => setData(json))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  // 前年度の執行率（pid → 執行率 のみ）。縮小判定で単年度の不用と2年連続の不用を区別するために使う
  useEffect(() => {
    setHistory(null);
    fetch(`/api/execution-history?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((json: ExecutionHistoryResponse) => setHistory(json))
      .catch(() => setHistory(null));
  }, [year]);

  /**
   * 全事業の政策評価。AI が全事業に付与した4観点と品質スコアの支出先系軸を統合する。
   * 判定の閾値は母集団の分位点から決まるため、全件を渡す必要がある（ページ分割前の値を使う）。
   */
  const policyByPid = useMemo(() => {
    if (!data) return null;
    // 前年度の執行率を突き合わせる。前年度に実績が無い事業は null のままで「判定不能」扱い
    const rates = history?.priorExecutionRates;
    const items = rates
      ? data.items.map(i => ({ ...i, priorExecutionRate: rates[i.pid] ?? null }))
      : data.items;
    return new Map(buildPolicyEvaluations(items).map(p => [p.pid, p]));
  }, [data, history]);

  /** 分布・絞り込みで参照する指標値。政策指標と品質軸のどちらも同じ経路で引く */
  const metricValue = useMemo(() => (item: QualityScoreItem, metric: DistMetric): number | null => {
    if (POLICY_METRICS.includes(metric)) {
      return policyByPid?.get(item.pid)?.[metric as PolicyMetric] ?? null;
    }
    return (item[metric as keyof QualityScoreItem] as number | null | undefined) ?? null;
  }, [policyByPid]);

  const filtered = useMemo<QualityScoreItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedMinistry) {
      items = items.filter(i => i.ministry === selectedMinistry);
    }

    if (policyByPid) {
      if (selectedRecommendation) items = items.filter(i => policyByPid.get(i.pid)?.recommendation === selectedRecommendation);
      if (selectedAction) items = items.filter(i => policyByPid.get(i.pid)?.improvementAction === selectedAction);
      if (selectedCategory) items = items.filter(i => policyByPid.get(i.pid)?.policyCategory === selectedCategory);
    }

    if (scoreRange !== 'all') {
      const [lo, hi] = scoreRange.split('-').map(Number);
      items = items.filter(i => {
        const s = metricValue(i, distMetric);
        if (s === null) return false;
        return s >= lo && s <= hi;
      });
    }

    if (searchQuery.trim()) {
      const normalize = (s: string) => s.replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
      const q = normalize(searchQuery.trim());
      items = items.filter(i =>
        normalize(i.name).includes(q) ||
        i.pid.includes(q) ||
        normalize(i.bureau).includes(q) ||
        normalize(i.section).includes(q) ||
        normalize(i.division).includes(q)
      );
    }

    for (const [metric, { min, max }] of Object.entries(scoreFilters)) {
      const lo = min.trim() === '' ? null : Number(min);
      const hi = max.trim() === '' ? null : Number(max);
      if (lo !== null && !Number.isNaN(lo)) {
        items = items.filter(i => {
          const v = policyByPid?.get(i.pid)?.[metric as PolicyMetric];
          return v != null && v >= lo;
        });
      }
      if (hi !== null && !Number.isNaN(hi)) {
        items = items.filter(i => {
          const v = policyByPid?.get(i.pid)?.[metric as PolicyMetric];
          return v != null && v <= hi;
        });
      }
    }

    {
      const lo = yearsFilter.min.trim() === '' ? null : Number(yearsFilter.min);
      const hi = yearsFilter.max.trim() === '' ? null : Number(yearsFilter.max);
      // 開始年度が未登録の事業は判定不能。絞り込みをかけたときだけ除外する
      if (lo !== null && !Number.isNaN(lo)) items = items.filter(i => i.yearsRunning != null && i.yearsRunning >= lo);
      if (hi !== null && !Number.isNaN(hi)) items = items.filter(i => i.yearsRunning != null && i.yearsRunning <= hi);
    }

    for (const [field, { min, max }] of Object.entries(amountFilters)) {
      const minVal = parseAmountInput(min);
      const maxVal = parseAmountInput(max);
      if (minVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) >= minVal);
      if (maxVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) <= maxVal);
    }

    // 政策評価列のソート順序。値が欠測の事業は昇順・降順いずれでも末尾に置く。
    const policyRank = (pid: string): number | null => {
      const p = policyByPid?.get(pid);
      if (!p) return null;
      if (sortField === 'recommendation') return p.recommendation ? (RECOMMENDATION_ORDER[p.recommendation] ?? 99) : null;
      if (sortField === 'improvementAction') return p.improvementAction ? (IMPROVEMENT_ACTION_ORDER[p.improvementAction] ?? 99) : null;
      return p[sortField as PolicyMetric];
    };
    const isPolicySort = (POLICY_METRICS as readonly string[]).includes(sortField)
      || sortField === 'recommendation' || sortField === 'improvementAction';

    items = [...items].sort((a, b) => {
      let cmp = 0;
      if (isPolicySort) {
        const ar = policyRank(a.pid);
        const br = policyRank(b.pid);
        if (ar === null || br === null) return ar === br ? 0 : ar === null ? 1 : -1;
        cmp = ar - br;
      } else if (sortField === 'pid') {
        cmp = parseInt(a.pid) - parseInt(b.pid);
      } else {
        const key = sortField as keyof QualityScoreItem;
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'string' && typeof bv === 'string') {
          cmp = av.localeCompare(bv, 'ja');
        } else {
          cmp = ((av as number) ?? -1) - ((bv as number) ?? -1);
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [data, policyByPid, metricValue, selectedRecommendation, selectedAction, selectedCategory,
      selectedMinistry, scoreRange, distMetric, searchQuery, scoreFilters, yearsFilter, amountFilters, sortField, sortDir]);

  // Reset page on filter change
  const amountFilterKey = Object.values(amountFilters).map(f => `${f.min}-${f.max}`).join(',')
    + '|' + Object.values(scoreFilters).map(f => `${f.min}-${f.max}`).join(',');
  const filterKey = `${selectedMinistry}|${scoreRange}|${distMetric}|${searchQuery}|${amountFilterKey}|${sortField}|${sortDir}`
    + `|${selectedRecommendation}|${selectedAction}|${selectedCategory}|${yearsFilter.min}-${yearsFilter.max}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      // 推奨・改善アクションは見直しシグナルの強い順（降順）を初期値にする
      setSortDir(field === 'recommendation' || field === 'improvementAction' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-0.5">↕</span>;
    return <span className="text-blue-500 ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !data) return (
    <div className="p-8 text-red-600 dark:text-red-400">
      <p className="font-semibold">データを読み込めません</p>
      <p className="text-sm mt-1">{error}</p>
      <p className="text-sm mt-2 text-gray-600 dark:text-gray-400">
        <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
          python3 scripts/score-project-quality.py
        </code> を実行してください
      </p>
    </div>
  );

  const { summary } = data;
  /** 絞り込みUIのカウント表示に使う全事業の政策評価。IIFE の外へ出して検索行からも参照できるようにする */
  const policyRows = policyByPid ? [...policyByPid.values()] : [];
  // 幅は固定。<select> は選択中の文言で幅が変わるため、放っておくと類型を選ぶたびに
  // 隣のUIが横に動く。truncate と併せて、選んでもレイアウトが動かないようにする。
  const selCls = 'shrink-0 truncate px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 '
    + 'rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer';

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {dialogItem && <ScoreDetailDialog item={dialogItem} policy={policyByPid?.get(dialogItem.pid)} onClose={() => setDialogItem(null)} year={year} />}
      {/* Header */}
      <div className="shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              事業別 政策評価・執行透明性スコア
            </h1>
            <Link href="/model-lab" className="ml-auto text-sm text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
              モデル比較 →
            </Link>
            {/* 年度とページ切替。全ページ共通で右上に置く */}
            <select
              value={year}
              onChange={e => setYear(e.target.value as '2024' | '2025')}
              aria-label="年度"
              className="h-9 rounded-lg border border-black/10 bg-white px-2 text-xs text-gray-700 shadow-sm cursor-pointer dark:border-white/10 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="2025">2025年度</option>
              <option value="2024">2024年度</option>
            </select>
            <PageNavMenu current="/quality" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {(() => {
              const all = policyByPid ? [...policyByPid.values()] : [];
              if (all.length === 0) return `${summary.total.toLocaleString()}事業`;
              const stat = (pick: (p: PolicyEvaluation) => number | null) => {
                const v = all.map(pick).filter((n): n is number => n !== null).sort((a, b) => a - b);
                if (!v.length) return null;
                return {
                  avg: v.reduce((a, b) => a + b, 0) / v.length,
                  med: v[Math.floor(v.length / 2)],
                  lo: v[0],
                  hi: v[v.length - 1],
                };
              };
              const metrics = [
                { label: '総合点', s: stat(p => p.overallScore) },
                ...AXIS_META.map(a => ({ label: a.label, s: stat(p => p[a.key]) })),
              ];
              const abolition = policyRows.filter(p => p.recommendation === '終了・廃止候補').length;
              return (
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono">{summary.total.toLocaleString()}事業</span>
                  {metrics.map(({ label, s }) => s && (
                    <span key={label} className="whitespace-nowrap" title={`${label}
平均 ${s.avg.toFixed(1)} / 中央 ${s.med} / 最小 ${s.lo} / 最大 ${s.hi}`}>
                      <span className="text-gray-600 dark:text-gray-300 font-medium">{label}</span>
                      <span className="ml-1 font-mono text-xs">
                        <span className="text-gray-400">平均</span>{s.avg.toFixed(0)}
                        <span className="text-gray-400 ml-1">中央</span>{s.med}
                      </span>
                    </span>
                  ))}
                  <span className="whitespace-nowrap">
                    <span className="text-gray-600 dark:text-gray-300 font-medium">終了・廃止候補</span>
                    <span className="ml-1 font-mono text-xs">{abolition.toLocaleString()}件</span>
                  </span>
                </span>
              );
            })()}
          </p>
        </div>
      </div>

      {/* Score distribution summary (10-point bins) + histogram */}
      <div className="relative shrink-0 w-full max-w-[1600px] mx-auto px-4 py-3">
        {(() => {
          const binRanges: { label: string; range: ScoreRange; lo: number; hi: number }[] = [
            { label: '100', range: '100-100', lo: 100, hi: 100 },
            { label: '90-99', range: '90-99', lo: 90, hi: 99 },
            { label: '80-89', range: '80-89', lo: 80, hi: 89 },
            { label: '70-79', range: '70-79', lo: 70, hi: 79 },
            { label: '60-69', range: '60-69', lo: 60, hi: 69 },
            { label: '50-59', range: '50-59', lo: 50, hi: 59 },
            { label: '40-49', range: '40-49', lo: 40, hi: 49 },
            { label: '30-39', range: '30-39', lo: 30, hi: 39 },
            { label: '20-29', range: '20-29', lo: 20, hi: 29 },
            { label: '10-19', range: '10-19', lo: 10, hi: 19 },
            { label: '0-9', range: '0-9', lo: 0, hi: 9 },
          ];
          const counts = binRanges.map(({ lo, hi }) =>
            data.items.filter(i => { const s = metricValue(i, distMetric); return s != null && s >= lo && s <= hi; }).length
          );
          const maxCount = Math.max(...counts, 1);
          const binColor = (lo: number) => {
            if (lo >= 90) return { bg: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', bar: 'bg-green-400' };
            if (lo >= 70) return { bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', bar: 'bg-blue-400' };
            if (lo >= 50) return { bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', bar: 'bg-yellow-400' };
            return { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', bar: 'bg-red-400' };
          };
          return (
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex items-end gap-0.5">
                {binRanges.map(({ label, range, lo }, i) => {
                  const count = counts[i];
                  const h = Math.max(2, Math.round((count / maxCount) * 56));
                  const { bar } = binColor(lo);
                  const isActive = scoreRange === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setScoreRange(isActive ? 'all' : range)}
                      className={`flex flex-col items-center transition-all ${isActive ? 'ring-1 ring-blue-500 rounded' : ''}`}
                      title={`${label}点: ${count}件`}
                    >
                      <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 mb-0.5">{count || ''}</span>
                      <div className={`w-7 rounded-sm ${bar}`} style={{ height: `${h}px` }} />
                      <span className="text-[9px] font-mono text-gray-400 mt-1">{label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-1 self-end">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-gray-500 dark:text-gray-400 leading-none">分布の軸</span>
                  <select
                    value={distMetric}
                    onChange={e => { setDistMetric(e.target.value as DistMetric); setScoreRange('all'); }}
                    className="text-xs border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer focus:ring-1 focus:ring-blue-500 outline-none"
                  >
                    {DIST_METRICS.map(m => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => setScoreRange('all')}
                  disabled={scoreRange === 'all'}
                  title={scoreRange === 'all' ? undefined : 'スコア帯の絞り込みを解除'}
                  className={`rounded-lg px-3 py-1.5 text-center transition-all bg-gray-100 dark:bg-gray-700 ${
                    scoreRange === 'all'
                      ? 'text-gray-600 dark:text-gray-300 cursor-default'
                      : 'ring-2 ring-blue-500 text-gray-900 dark:text-white hover:opacity-90'
                  }`}
                >
                  <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400">表示 / 全件</div>
                  <div className="text-sm font-bold font-mono whitespace-nowrap">
                    <span className={filtered.length !== summary.total ? 'text-blue-600 dark:text-blue-400' : ''}>
                      {filtered.length.toLocaleString()}
                    </span>
                    <span className="text-gray-400 font-normal"> / {summary.total.toLocaleString()}</span>
                  </div>
                </button>
              </div>
              <div className="flex flex-col gap-1.5 self-end flex-1 min-w-[200px]">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="事業名・PID・組織名で検索..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[120px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <select
                    value={selectedMinistry}
                    onChange={e => setSelectedMinistry(e.target.value)}
                    className="w-[162px] shrink-0 truncate px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 cursor-pointer"
                  >
                    <option value="">全府省庁</option>
                    {summary.ministries.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {/* 政策評価の絞り込み。1行に収めるため検索・府省庁と同居させる */}
                  {policyByPid && <>
                        <select value={selectedRecommendation} onChange={e => setSelectedRecommendation(e.target.value)} className={`w-[154px] ${selCls}`}>
                          <option value="">推奨: すべて</option>
                          {RECOMMENDATION_LABELS.map(label => (
                            <option key={label} value={label}>
                              {label}（{policyRows.filter(p => p.recommendation === label).length.toLocaleString()}）
                            </option>
                          ))}
                        </select>
                        <select value={selectedAction} onChange={e => setSelectedAction(e.target.value)} className={`w-[142px] ${selCls}`}>
                          <option value="">改善: すべて</option>
                          {IMPROVEMENT_ACTION_LABELS.map(label => (
                            <option key={label} value={label}>
                              {label}（{policyRows.filter(p => p.improvementAction === label).length.toLocaleString()}）
                            </option>
                          ))}
                        </select>
                        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className={`w-[194px] ${selCls}`}>
                          {/* 政策類型は32分類あるため、7つの上位グループで optgroup にまとめる */}
                          <option value="">類型: すべて</option>
                          {POLICY_CATEGORY_GROUPS.map(group => (
                            <optgroup key={group.id} label={group.label}>
                              {group.categories.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.label}（{policyRows.filter(p => p.policyCategory === c.id).length.toLocaleString()}）
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {/*
                          出現・消滅させると検索欄(flex-1)が伸縮してセレクト群が横に動くため、常に描画する。
                          透明にすると「使っていない余白」に見えてしまうので、無効時は淡色で残す。
                        */}
                        <button
                          onClick={() => { setSelectedRecommendation(''); setSelectedAction(''); setSelectedCategory(''); }}
                          disabled={!(selectedRecommendation || selectedAction || selectedCategory)}
                          title="推奨・改善・類型の絞り込みを解除"
                          className="shrink-0 text-[11px] text-gray-400 enabled:hover:text-gray-700 dark:enabled:hover:text-gray-100 disabled:opacity-30 disabled:cursor-default"
                        >
                          ✕ 解除
                        </button>
                  </>}
                </div>
                {/* 金額の範囲フィルタ */}
                <div className="flex items-center gap-1 text-xs flex-wrap">
                  {([
                    { key: 'budgetAmount', label: '予算', desc: COL_DESC.予算額 },
                    { key: 'execAmount', label: '執行', desc: COL_DESC.執行額 },
                    { key: 'spendTotal', label: '支出計', desc: COL_DESC.支出先合計 },
                    { key: 'spendNetTotal', label: '実質', desc: COL_DESC.実質支出額 },
                  ] as const).map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center shrink-0" title={desc}>
                      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">{label}</span>
                      <RangeStepInput
                        value={amountFilters[key].min} width={50} placeholder="下限" title="下限 (例: 100億, 1兆)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                      />
                      <span className="text-gray-400 mx-px">~</span>
                      <RangeStepInput
                        value={amountFilters[key].max} width={50} placeholder="上限" title="上限 (例: 1兆, 5000億)"
                        onStep={stepAmount}
                        onChange={v => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                      />
                      <button
                        onClick={() => setAmountFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                        disabled={!(amountFilters[key].min || amountFilters[key].max)}
                        className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                      <div className="flex items-center shrink-0" title={COL_DESC.継続年数}>
                        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">年数</span>
                        <RangeStepInput
                          value={yearsFilter.min} width={50} placeholder="下限" title="下限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, min: v }))}
                        />
                        <span className="text-gray-400 mx-px">~</span>
                        <RangeStepInput
                          value={yearsFilter.max} width={50} placeholder="上限" title="上限（年）"
                          onStep={(c, d) => stepScore(c, d, 110, 5)}
                          onChange={v => setYearsFilter(prev => ({ ...prev, max: v }))}
                        />
                        <button
                          onClick={() => setYearsFilter({ min: '', max: '' })}
                          disabled={!(yearsFilter.min || yearsFilter.max)}
                          className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                        >
                          ✕
                        </button>
                      </div>
                      {/* 指標の説明。足きり行は6組で最も詰まるので、余裕のある金額行の末尾に置く */}
                      {/* 指標の説明なので、指標そのものが並ぶこの行の末尾に置く */}
                      <button
                      onClick={() => setShowGuide(v => !v)}
                      className="ml-auto shrink-0 text-[11px] text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                      >
                      {showGuide ? '▲ 読み方を閉じる' : '▼ 指標の読み方'}
                      </button>
                </div>
                {/* 足きり。1600px幅で列Cは1040pxあり7組が収まる。狭い画面では折り返す */}
                {policyByPid && (
                  <div className="flex items-center gap-1 text-xs flex-wrap">
                        {([
                          { key: 'overallScore' as const, label: '総合', desc: COL_DESC.総合点 },
                          ...AXIS_META.map(a => ({ key: a.key, label: a.short,
                            desc: `${a.label}（総合点への重み ${a.weight}）

${a.desc}` })),
                        ]).map(({ key, label, desc }) => (
                          <div key={key} className="flex items-center shrink-0" title={desc}>
                            <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5 cursor-help underline decoration-dotted decoration-gray-300 underline-offset-2">{label}</span>
                            <RangeStepInput
                              value={scoreFilters[key].min} width={50} placeholder="下限" title="下限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], min: v } }))}
                            />
                            <span className="text-gray-400 mx-px">~</span>
                            <RangeStepInput
                              value={scoreFilters[key].max} width={50} placeholder="上限" title="上限 (0-100)"
                              onStep={(c, d) => stepScore(c, d)}
                              onChange={v => setScoreFilters(prev => ({ ...prev, [key]: { ...prev[key], max: v } }))}
                            />
                            <button
                              onClick={() => setScoreFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                              disabled={!(scoreFilters[key].min || scoreFilters[key].max)}
                              className="ml-0.5 text-gray-400 enabled:hover:text-gray-600 dark:enabled:hover:text-gray-200 disabled:opacity-0"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* 指標の説明。フローに置くと展開したぶん表が押し下げられるので、絶対配置で表の上に重ねる */}
        {policyByPid && showGuide && (
        <p className="absolute left-4 right-4 top-full z-20 -mt-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 shadow-lg text-[11px] leading-5 text-gray-600 dark:text-gray-300">
        <span className="font-semibold">政策評価</span>は「誰のどんな課題を、どの活動で、どう改善するか」がどれだけ明確に説明され、
        その成果を検証できる状態かどうか。
        <span className="font-semibold">執行透明性</span>は支出先が特定できるか・使途を説明できるか（支出先の明確さ55＋使途の説明45）。
        「収支の一致」は9割の事業が満点でほぼ定数だったため加重平均から外し、不一致（60点未満）だけをフラグとして拾っています。
        <span className="font-semibold">総合点</span>は政策評価と執行透明性を統合した値です。
        推奨は絶対点ではなく<span className="font-semibold">母集団内の順位帯</span>で切っています（総合点は中央に強く偏るため、絶対値では下位帯が空になる）。
        「<span className="font-semibold">縮小</span>」は事業の優劣ではなく<span className="font-semibold">不用額</span>（予算と執行の乖離）に基づく計上額の見直しで、総合点には影響しません
        — 不用額の返納は適切な行動であり、減点すると使い切りを誘発するためです。
        単年度の不用は入札差金でも生じるため、縮小は<span className="font-semibold">2年連続で不用率が上位帯</span>にある事業に限定し（一覧に「2年連続の不用」を表示）、
        単年度のみ・前年度実績が無い事業は要改善（差異理由の説明）にとどめています。
        逆に予算をほぼ消化していても支出先が不透明な事業は「継続」とせず要改善として拾います。
        「終了・廃止候補」は結論ではなく政党レビューへ送るためのスクリーニング結果です。
        判断（推奨）と改善（改善アクション）は分離して表示しています。
        </p>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 flex flex-col w-full max-w-[1600px] mx-auto px-4 pb-4">
        {/*
          外枠（枠線・角丸）と、スクロールする内箱を分ける。
          ページャを枠の中のフッタとして固定したいので、枠自体はスクロールさせない。
          内箱を縦にもスクロールさせるのは thead の sticky を効かせるため。overflow-x だけだと
          overflow-y が auto に計算され、高さ制限の無い箱が縦のスクロールコンテナになってしまう。
        */}
        <div className="flex-1 min-h-0 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
        <div ref={tableScrollRef} className="flex-1 min-h-0 overflow-auto">
          {/* table-fixed + colgroup: ソートで中身が変わっても列幅が動かないようにする */}
          <table className="w-full text-xs table-fixed min-w-[1754px]">
            <colgroup>
              {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap" title={COL_DESC.PID} onClick={() => handleSort('pid')}>
                  PID<SortIcon field="pid" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer truncate" title={COL_DESC.事業名} onClick={() => handleSort('name')}>
                  事業名<SortIcon field="name" />
                </th>
                <th className="px-2 py-2 text-left whitespace-nowrap" title={COL_DESC.府省庁}>府省庁</th>
                <th className="px-2 py-2 text-left whitespace-nowrap" title={COL_DESC.組織}>局・庁</th>
                <th className="px-2 py-2 text-center whitespace-nowrap" title={COL_DESC.支出先列}>支出先</th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.総合点} onClick={() => handleSort('overallScore')}>
                  総合点<SortIcon field="overallScore" />
                </th>
                {AXIS_META.map(a => (
                  <th
                    key={a.key}
                    className="px-2 py-2 text-right cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60"
                    title={`${a.label}（総合点への重み ${a.weight}）

${a.desc}`}
                    onClick={() => handleSort(a.key)}
                  >
                    {a.label}<SortIcon field={a.key} />
                  </th>
                ))}
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.推奨} onClick={() => handleSort('recommendation')}>
                  推奨<SortIcon field="recommendation" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap bg-violet-50 dark:bg-violet-950/60" title={COL_DESC.改善アクション} onClick={() => handleSort('improvementAction')}>
                  改善アクション<SortIcon field="improvementAction" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.継続年数} onClick={() => handleSort('yearsRunning')}>
                  継続年数<SortIcon field="yearsRunning" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.予算額} onClick={() => handleSort('budgetAmount')}>
                  予算額<SortIcon field="budgetAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.執行額} onClick={() => handleSort('execAmount')}>
                  執行額<SortIcon field="execAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.支出先合計} onClick={() => handleSort('spendTotal')}>
                  支出先合計<SortIcon field="spendTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.実質支出額} onClick={() => handleSort('spendNetTotal')}>
                  実質支出額<SortIcon field="spendNetTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.再委託階層} onClick={() => handleSort('redelegationDepth')}>
                  再委託階層<SortIcon field="redelegationDepth" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" title={COL_DESC.支出先数} onClick={() => handleSort('rowCount')}>
                  支出先数<SortIcon field="rowCount" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageItems.map(item => {
                const policy = policyByPid?.get(item.pid);
                return (
                <React.Fragment key={item.pid}>
                  <tr
                    className="hover:bg-blue-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(expandedRow === item.pid ? null : item.pid)}
                  >
                    <td className="px-2 py-1.5 font-mono text-gray-500">{item.pid}</td>
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white truncate" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 truncate" title={item.ministry}>{item.ministry}</td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 truncate" title={item.bureau || undefined}>{item.bureau || '-'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); setDialogItem(item); }}
                        className="px-2 py-1 text-[11px] font-medium rounded-md border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
                        title="支出先一覧・スコア計算根拠を表示"
                      >
                        詳細
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right bg-violet-50/50 dark:bg-violet-950/40">
                      {policy?.overallScore != null
                        ? <span className={`font-bold font-mono ${scoreColor(policy.overallScore)}`}>{policy.overallScore}</span>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    {AXIS_META.map(a => {
                      const v = policy?.[a.key];
                      return (
                        <td key={a.key} className="px-2 py-1.5 text-right whitespace-nowrap bg-violet-50/50 dark:bg-violet-950/40">
                          {v != null
                            ? <span className={`font-mono ${scoreColor(v)}`}>{v}</span>
                            : <span className="text-gray-300 dark:text-gray-600" title="未評価（総合点では重みごと除外）">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 bg-violet-50/50 dark:bg-violet-950/40">
                      {policy
                        ? <><RecommendationBadge policy={policy} /><PersistentUnusedMark policy={policy} /></>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-1.5 bg-violet-50/50 dark:bg-violet-950/40">
                      {policy?.improvementAction
                        ? <ActionBadge action={policy.improvementAction} />
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap"
                      title={item.startYear ? `${item.startYear}年度開始 / ${item.noEndDate ? '終了予定なし' : (item.endYear ? `${item.endYear}年度終了予定` : '終了年度未設定')}` : '開始年度の登録なし'}
                    >
                      {item.yearsRunning != null
                        ? <><span className={item.yearsRunning >= 20 ? 'text-orange-600 dark:text-orange-400 font-semibold' : ''}>{item.yearsRunning}</span>
                            {item.noEndDate && <span className="text-gray-400 ml-0.5">★</span>}</>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.budgetAmount ? formatAmount(item.budgetAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.execAmount ? formatAmount(item.execAmount) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendTotal ? formatAmount(item.spendTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.spendNetTotal ? formatAmount(item.spendNetTotal) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {item.redelegationDepth || '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-gray-500">{item.recipientCount ?? item.rowCount}</td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={19} className="px-4 py-3">
                        <div className="mb-2 text-gray-800 dark:text-gray-100">{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              政策評価
                              {policy?.policyCategoryLabel && (
                                <span className="ml-1 font-normal text-gray-400">{policy.policyCategoryLabel}</span>
                              )}
                            </h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div className="font-mono">総合点 {policy?.overallScore ?? '—'}点</div>
                              {AXIS_META.filter(a => a.key !== 'executionTransparency').map(a => (
                                <div key={a.key}>{a.label}: {policy?.[a.key] ?? '未評価'}</div>
                              ))}
                              {policy?.findings.necessity && (
                                <div className="text-[10px] leading-relaxed">{policy.findings.necessity}</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">執行透明性</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div className="font-mono">{policy?.executionTransparency ?? '—'}点</div>
                              <div>支出先の明確さ: {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : '—'}</div>
                              <div>使途の説明: {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : '—'}</div>
                              <div className="text-gray-400">収支の一致: {item.axisBudget != null ? item.axisBudget.toFixed(0) : '—'}（不算入・不一致フラグ）</div>
                              <div>法人番号記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              予算と執行
                              <span className="ml-1 font-normal text-gray-400">（総合点に不算入）</span>
                            </h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>予算額: {formatAmount(item.budgetAmount)}</div>
                              <div>執行額: {formatAmount(item.execAmount)}</div>
                              {policy?.executionRate != null ? (
                                <>
                                  <div>執行率: {Math.round(policy.executionRate * 100)}%</div>
                                  <div>不用額: {policy.unusedAmount ? formatAmount(policy.unusedAmount) : '0'}
                                    {policy.unusedRatio != null && `（${Math.round(policy.unusedRatio * 100)}%）`}</div>
                                </>
                              ) : (
                                <div className="text-gray-400">執行実績なし（評価対象外）</div>
                              )}
                              <div>
                                前年度: {policy?.priorExecutionRate != null
                                  ? `執行率 ${Math.round(policy.priorExecutionRate * 100)}%・不用率 ${Math.round((policy.priorUnusedRatio ?? 0) * 100)}%`
                                  : <span className="text-gray-400">実績なし（判定不能）</span>}
                              </div>
                              {policy && (
                                <div className={UNUSED_TREND_META[policy.unusedTrend].cls}>
                                  {UNUSED_TREND_META[policy.unusedTrend].label}
                                </div>
                              )}
                              <div>実質支出額: {formatAmount(item.spendNetTotal)}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">推奨と改善</h4>
                            <div className="space-y-1 text-gray-600 dark:text-gray-400">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {policy && <RecommendationBadge policy={policy} />}
                                {policy?.improvementAction && <ActionBadge action={policy.improvementAction} />}
                              </div>
                              {policy?.recommendationReason && (
                                <div className="text-[10px] leading-relaxed">{policy.recommendationReason}</div>
                              )}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">組織・支出構造</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>{[item.ministry, item.bureau, item.division, item.section, item.office].filter(Boolean).join(' › ')}</div>
                              <div>支出先数: {item.recipientCount ?? item.rowCount}／ブロック: {item.blockCount}{item.orphanBlockCount > 0 && <span className="text-orange-500">（孤立 {item.orphanBlockCount}）</span>}</div>
                              <div>再委託: {item.hasRedelegation ? `あり（階層${item.redelegationDepth}）` : 'なし'}</div>
                              <div>不透明支出比: {pct(item.opaqueRatio)}</div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
          {pageItems.length === 0 && (
            <div className="px-4 py-16 text-center">
              <div className="text-sm text-gray-500 dark:text-gray-400">条件に合う事業がありません</div>
              <div className="mt-1 text-xs text-gray-400">絞り込みを緩めるか、解除してください</div>
              <button
                onClick={() => {
                  setSearchQuery(''); setSelectedMinistry(''); setScoreRange('all');
                  setSelectedRecommendation(''); setSelectedAction(''); setSelectedCategory('');
                  setScoreFilters(EMPTY_SCORE_FILTERS());
                  setYearsFilter({ min: '', max: '' });
                  setAmountFilters({
                    budgetAmount: { min: '', max: '' }, execAmount: { min: '', max: '' },
                    spendTotal: { min: '', max: '' }, spendNetTotal: { min: '', max: '' },
                  });
                }}
                className="mt-3 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                すべての絞り込みを解除
              </button>
            </div>
          )}
        </div>

        {/* ページャは表の枠内フッタ。表とページ番号が離れて見えないようにする */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 shrink-0 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <button
              onClick={() => goToPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              前へ
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {page} / {totalPages}
              <span className="ml-2 text-gray-400">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()} 件目
              </span>
            </span>
            <button
              onClick={() => goToPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              次へ
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
