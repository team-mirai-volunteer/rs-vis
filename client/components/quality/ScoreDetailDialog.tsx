'use client';

/**
 * 品質スコアの詳細ダイアログ。/quality・/sankey-svg・/subcontracts/[projectId] で共用する。
 *
 * 支出先・事業詳細・政策評価はダイアログを開いたときだけ取得し、モジュールスコープで
 * キャッシュする（同一事業への同時リクエストは1本にまとめる）。
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { ProjectDetail } from '@/types/project-details';
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';
import { externalCorporateLinks } from '@/app/lib/api/links';
import { useScoreDetailData } from '@/client/hooks/useScoreDetailData';
import { scoreColor, formatAmount, pct } from '@/client/components/quality/score-format';
import {
  AXIS_META, COL_DESC, UNUSED_TREND_META, WEIGHT_BY_KEY, STATUS_META,
  RecommendationBadge, ActionBadge, PersistentUnusedMark, fmtRaw,
} from '@/client/components/quality/score-meta';

/**
 * 事業概要の「/」区切りを改行にする。
 * 元データは「目的/現状課題/概要」のように / で節を区切るが、本文には URL・日付(2024/4/1)・
 * 分数(1/2) も混ざる。URL はまるごと保護し、数字に挟まれた / は区切りとみなさない。
 */
function breakOnSeparators(text: string): string {
  return text
    .split(/(https?:\/\/\S+)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(?<![0-9])\/(?![0-9])/g, '\n')))
    .join('');
}

export function ScoreDetailDialog({ item, policy: policyProp, onClose, year }: {
  item: QualityScoreItem;
  /**
   * 政策評価。母集団のパーセンタイル・分位点から決まるため1事業だけでは算出できない。
   * /quality は全件から組み立て済みのものを渡す。渡されない場合（サンキー図・再委託ビュー）は
   * /api/policy-summary?pid= から取得する。
   */
  policy?: PolicyEvaluation;
  onClose: () => void;
  year: string;
}) {
  // 取得はフックに閉じる（再利用可能UIから直接APIを叩かない）
  const data = useScoreDetailData(item.pid, year, policyProp != null);
  const { recipients, recipientsError, projectInfo, policyError } = data;
  const policy = policyProp ?? data.policy ?? undefined;

  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a2' | 'pct'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);
  const [showPolicy, setShowPolicy] = useState(true);
  const [showProjectInfo, setShowProjectInfo] = useState(true);
  // 法人番号列（index 2）は13桁＋gBizINFOアイコンが入るため 130 まで広げる（旧ダイアログと同じ）
  const COL_MAX_WIDTHS = [undefined, 70, 130, 60, 50, undefined, undefined];
  const [colWidths, setColWidths] = useState<number[]>([200, 70, 130, 60, 50, 200, 200]);
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

  // 事業が切り替わったら表示状態だけ初期化する（データ取得はフック側）
  useEffect(() => {
    setRecipientSearch('');
    setRecipientSortField('chain');
    setRecipientSortDir('asc');
    setShowAxisDetail(false);
    setShowPolicy(true);
    setShowProjectInfo(true);
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
      else if (recipientSortField === 'c') {
        // 法人番号そのもので並べる（有効な番号は13桁固定なので文字列比較＝数値順）。
        // 番号の大小だけを方向に従わせ、それ以外は方向で反転させたくないので、
        // この分岐は最後の一括反転（recipientSortDir）を通さず自前で return する。
        const acn = (a.cn ?? '').trim();
        const bcn = (b.cn ?? '').trim();
        // 未記入は値が無いだけで大小を持たないため、昇順・降順どちらでも末尾に固定する
        if (!acn || !bcn) return (acn ? 0 : 1) - (bcn ? 0 : 1) || (b.a2 ?? -1) - (a.a2 ?? -1);
        const cnCmp = acn.localeCompare(bcn);
        if (cnCmp !== 0) return recipientSortDir === 'desc' ? -cnCmp : cnCmp;
        // 同一番号内は常に金額降順（方向に応じて昇順へ反転させない）
        return (b.a2 ?? -1) - (a.a2 ?? -1);
      }
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
                <span><span className="text-gray-400">執行:</span><span className="font-mono">{formatAmount(item.execAmount ?? 0)}</span></span>
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
                    <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{breakOnSeparators(text)}</div>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* 政策評価の取得に失敗したときは黙って消さず、失敗したと分かるようにする */}
        {policyError && !policy && (
          <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700 text-xs text-red-600 dark:text-red-400">
            政策評価を読み込めませんでした（{policyError}）
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
                    執行 {formatAmount(item.execAmount ?? 0)} vs 実質支出 {formatAmount(item.spendNetTotal)}
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
                  予算 {formatAmount(item.budgetAmount)} → 執行 {formatAmount(item.execAmount ?? 0)}
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
                      { label: '法人番号', align: 'center', sort: 'c' as const, title: '法人番号(Corporate Number)。番号順でソート（未記入は末尾）。⚠は形式不正（誤記載の疑い）' },
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
                        <td className="px-2 py-1.5 text-center">
                          {(() => {
                            const cn = row.cn?.trim() ?? '';
                            if (!cn) return <span className="text-gray-300 dark:text-gray-600">—</span>;
                            // 有効な法人番号のみ gBizINFO へリンク（検証・URL構築は共有ヘルパーに集約）
                            // 番号はコピペ用に選択可能なテキストのままにし、リンクジャンプはアイコンクリック時のみ
                            const links = externalCorporateLinks(cn);
                            if (links) {
                              return (
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] leading-none text-gray-600 dark:text-gray-300" title={cn}>
                                  <span className="select-text leading-none">{cn}</span>
                                  <a
                                    href={links.gbizinfo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 inline-flex items-center -mt-0.5 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                                    title={`gBizINFO で法人番号を確認: ${cn}`}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" height="12" width="12" viewBox="0 0 24 24" fill="currentColor" className="block" aria-hidden="true">
                                      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
                                    </svg>
                                  </a>
                                </span>
                              );
                            }
                            return (
                              <span
                                className="font-mono text-[10px] text-amber-700 dark:text-amber-300 font-semibold"
                                title={`法人番号の形式が不正（誤記載の疑い）: ${cn}`}
                              >
                                {cn}<span className="ml-0.5">⚠</span>
                              </span>
                            );
                          })()}
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
