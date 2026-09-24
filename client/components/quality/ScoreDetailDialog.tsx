'use client';

/**
 * 品質スコアの詳細ダイアログ。/quality・/sankey-svg・/subcontracts/[projectId] で共用する。
 *
 * 支出先・事業詳細・政策評価はダイアログを開いたときだけ取得し、モジュールスコープで
 * キャッシュする（同一事業への同時リクエストは1本にまとめる）。
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link2, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';
import { externalCorporateLinks } from '@/app/lib/api/links';
import { useScoreDetailData } from '@/client/hooks/useScoreDetailData';
import { useDialogFocus } from '@/client/hooks/useDialogFocus';
import { ProjectComments } from '@/client/components/comments/ProjectComments';
import { scoreColor, formatAmount, pct } from '@/client/components/quality/score-format';
import { ProjectDetailShare } from './ProjectDetailShare';
import {
  AXIS_META, COL_DESC, UNUSED_TREND_META, WEIGHT_BY_KEY, STATUS_META,
  RecommendationBadge, ActionBadge, fmtRaw,
} from '@/client/components/quality/score-meta';

/**
 * 事業概要の「/」区切りを改行にする。
 * 元データは「目的/現状課題/概要」のように / で節を区切るが、本文には URL・日付(2024/4/1)・
 * 分数(1/2) も混ざる。URL はまるごと保護し、数字に挟まれた / は区切りとみなさない。
 */
/** ヘッダ下の「▼ 事業内容」等の開閉リンク。Button の link variant を 11px の細字に寄せる */
const TOGGLE_LINK_CLS = 'text-[11px] font-normal no-underline hover:underline hover:text-primary-accent';

const COL_MAX_WIDTHS = [undefined, 70, 130, 60, 50, undefined, undefined];

function breakOnSeparators(text: string): string {
  return text
    .split(/(https?:\/\/\S+)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(?<![0-9])\/(?![0-9])/g, '\n')))
    .join('');
}

export function ScoreDetailDialog({ item, policy: policyProp, onClose, year, navigation }: {
  item: QualityScoreItem;
  /**
   * 政策評価。母集団のパーセンタイル・分位点から決まるため1事業だけでは算出できない。
   * /quality は全件から組み立て済みのものを渡す。渡されない場合（サンキー図・再委託ビュー）は
   * /api/policy-summary?pid= から取得する。
   */
  policy?: PolicyEvaluation;
  onClose: () => void;
  year: string;
  navigation?: React.ReactNode;
}) {
  // 取得はフックに閉じる（再利用可能UIから直接APIを叩かない）
  const data = useScoreDetailData(item.pid, year, policyProp != null);
  const { recipients, recipientsError, recipientsAvailable, sourceYear, projectInfo, policyError } = data;
  const policy = policyProp ?? data.policy ?? undefined;

  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a2' | 'pct'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);
  const [showPolicy, setShowPolicy] = useState(true);
  const [showProjectInfo, setShowProjectInfo] = useState(true);
  // 法人番号列（index 2）は13桁＋gBizINFOアイコンが入るため 130 まで広げる（旧ダイアログと同じ）
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

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

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
  }, [recipients, recipientSearch, recipientSortField, recipientSortDir, item.spendNetTotal]);

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
    if (recipientSortField !== field) return <span className="text-mirai-text-placeholder ml-0.5">↕</span>;
    return <span className="text-primary ml-0.5">{recipientSortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} の詳細`}
        className="bg-card rounded-3xl border border-mirai-border shadow-soft w-full min-w-0 max-w-8xl mx-4 max-h-[92dvh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-3 border-b border-mirai-border flex items-start justify-between gap-3 shrink-0 bg-mirai-surface-gray rounded-t-3xl">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="text-sm font-bold text-mirai-text leading-snug">{item.name}</div>
              <ProjectDetailShare pid={item.pid} year={year} />
              {navigation}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] text-mirai-text-muted">
              <span className="font-mono bg-mirai-surface-light text-mirai-text-subtle px-1.5 py-0.5 rounded-md">PID {item.pid}</span>
              {[item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).map((org, i) => (
                <span key={i}>{i > 0 ? '' : ''}<span className={i === 0 ? 'font-medium' : ''}>{org}</span>{i < [item.ministry, item.bureau, item.division, item.section, item.office, item.team, item.unit].filter(Boolean).length - 1 ? <span className="text-mirai-text-placeholder mx-0.5">›</span> : null}</span>
              ))}
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="閉じる（Esc）" title="閉じる（Esc）" className="shrink-0 text-mirai-text-muted hover:bg-mirai-surface-light hover:text-mirai-text">
            <X className="size-4" />
          </Button>
        </div>

        {/* Score summary — single compact row */}
        <div className="px-6 py-2.5 border-b border-mirai-border shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            <div className="shrink-0 text-center">
              <div className={`text-2xl font-bold font-mono leading-none cursor-help ${scoreColor(policy?.overallScore ?? null)}`} title={COL_DESC.総合点}>
                {policy?.overallScore ?? '—'}
              </div>
              <div className="text-[9px] text-mirai-text-muted mt-0.5">総合点</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {AXIS_META.map(a => {
                const score = policy?.[a.key] ?? null;
                return (
                  <div key={a.key} className="text-center cursor-help" title={`${a.label}（総合点への重み ${a.weight}）

${a.desc}`}>
                    <div className={`text-sm font-bold font-mono leading-none ${scoreColor(score)}`}>
                      {score ?? '—'}
                    </div>
                    <div className="text-[9px] text-mirai-text-muted mt-0.5 whitespace-nowrap">{a.label}</div>
                  </div>
                );
              })}
            </div>
            {/* Divider */}
            <div className="w-px h-8 bg-mirai-surface-light shrink-0" />
            {/* Key metrics — 3 lines inline */}
            <div className="flex-1 min-w-0 text-[10px] text-mirai-text-secondary space-y-0.5">
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-mirai-text-muted">予算:</span><span className="font-mono">{formatAmount(item.budgetAmount)}</span></span>
                <span><span className="text-mirai-text-muted">執行:</span><span className="font-mono">{recipientsAvailable ? formatAmount(item.execAmount ?? 0) : '未収録'}</span></span>
                <span><span className="text-mirai-text-muted">実質支出:</span><span className="font-mono">{recipientsAvailable ? formatAmount(item.spendNetTotal) : '未収録'}</span></span>
                <span><span className="text-mirai-text-muted">乖離率:</span><span className="font-mono">{pct(item.gapRatio)}</span></span>
              </div>
              <div className="flex flex-wrap gap-x-3">
                <span><span className="text-mirai-text-muted">支出先数:</span><span className="font-mono">{!recipientsAvailable ? '未収録' : recipientsError ? '取得できません' : recipients?.length ?? '...'}</span></span>
                <span><span className="text-mirai-text-muted">ブロック:</span>{item.blockCount}件</span>
                {item.hasRedelegation && <span><span className="text-mirai-text-muted">深度:</span><span className="text-orange-500">{item.redelegationDepth}</span></span>}
                {item.opaqueRatio !== null && item.opaqueRatio > 0 && <span><span className="text-mirai-text-muted">不透明:</span><span className="text-amber-500">{pct(item.opaqueRatio)}</span></span>}
              </div>
              <div className="flex flex-wrap gap-x-3 items-center">
                {item.identifyLevelAvg != null && <span><span className="text-mirai-text-muted">特定Lv</span> <span className="font-mono">{item.identifyLevelAvg.toFixed(1)}/3</span></span>}
                {item.purposeLevelAvg != null && <span><span className="text-mirai-text-muted">使途Lv</span> <span className="font-mono">{item.purposeLevelAvg.toFixed(1)}/3</span></span>}
                <span><span className="text-mirai-text-muted">valid</span> <span className="font-mono">{axis1Num}/{axis1Total}</span></span>
                <span><span className="text-mirai-text-muted">法人番号</span> <span className="font-mono">{item.cnFilled}/{item.cnFilled + item.cnEmpty}</span></span>
                {item.aiSource && (
                  <span className={`inline-block px-1.5 py-0.5 rounded-md text-[9px] font-bold ${isAi ? 'bg-mirai-surface-teal text-primary-accent' : 'bg-mirai-surface-light text-mirai-text-muted'}`} title={item.aiSource}>
                    {isAi ? 'AI評価' : 'ヒューリスティック'}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* 何を評価した結果なのかを先に読めるよう、事業内容 → 政策評価 → 計算根拠 の順に並べる */}
          <div className="mt-1 flex items-center gap-4">
            <Button
              variant="link"
              onClick={() => setShowProjectInfo(d => !d)}
              className={TOGGLE_LINK_CLS}
            >
              {showProjectInfo ? '▲ 事業内容を閉じる' : '▼ 事業内容'}
            </Button>
            {policy && (
              <Button
                variant="link"
                onClick={() => setShowPolicy(d => !d)}
                className={TOGGLE_LINK_CLS}
              >
                {showPolicy ? '▲ 政策評価を閉じる' : '▼ 政策評価'}
              </Button>
            )}
            <Button
              variant="link"
              onClick={() => setShowAxisDetail(d => !d)}
              className={TOGGLE_LINK_CLS}
            >
              {showAxisDetail ? '▲ 計算根拠を閉じる' : '▼ スコア計算根拠'}
            </Button>
          </div>
        </div>

        {/*
          ここから下はモーダル内で唯一のスクロール領域。
          以前は各セクションが個別に max-h + overflow-y-auto を持っていて、
          モーダル自身のスクロールと二重になり、どこを掴んでいるのか分からなくなっていた。
        */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!recipientsAvailable && <p className="border-b border-border bg-mirai-surface px-6 py-3 text-xs text-mirai-text-muted">{year}年度は予算要求の表示です。以下の事業概要・評価は{sourceYear}年度RSシートを参照しています。{year}年度の支出先・執行実績は未収録です。</p>}

        {/* 事業内容（目的・現状課題・概要）— 成果設計の判定材料 */}
        {showProjectInfo && (
          <div className="px-6 py-3 border-b border-mirai-border bg-mirai-surface-gray">
            {projectInfo === undefined && (
              <div className="flex items-center gap-2 text-xs text-mirai-text-muted">
                <Loader2 className="size-3 animate-spin text-mirai-text-muted" aria-hidden="true" />
                事業内容を読み込み中...
              </div>
            )}
            {projectInfo === null && <div className="text-xs text-mirai-text-muted">事業内容データなし</div>}
            {projectInfo && (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-mirai-text-muted">
                  {projectInfo.category && <span>区分: {projectInfo.category}</span>}
                  {projectInfo.startYear && <span>開始: {projectInfo.startYear}年度</span>}
                  <span>終了: {projectInfo.noEndDate ? '予定なし' : (projectInfo.endYear ? `${projectInfo.endYear}年度` : '-')}</span>
                  {projectInfo.implementationMethods?.length > 0 && <span>実施方法: {projectInfo.implementationMethods.join('・')}</span>}
                  {projectInfo.url && <a href={projectInfo.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline hover:text-primary-accent">事業概要URL ↗</a>}
                </div>
                {([
                  { label: '目的', text: projectInfo.purpose },
                  { label: '現状・課題', text: projectInfo.currentIssues },
                  { label: '概要', text: projectInfo.overview },
                ] as const).map(({ label, text }) => text ? (
                  <div key={label}>
                    <div className="font-bold text-mirai-text-secondary">{label}</div>
                    <div className="text-mirai-text-subtle whitespace-pre-wrap leading-relaxed">{breakOnSeparators(text)}</div>
                  </div>
                ) : null)}
              </div>
            )}
          </div>
        )}

        {/* みんなの意見（AIインタビューで集めた匿名意見）。Supabase 未配布環境では描かれない */}
        <div className="px-6 py-3 border-b border-mirai-border empty:hidden">
          {recipientsAvailable ? <ProjectComments
            bare
            context={{
              pid: item.pid,
              year,
              projectName: item.name,
              ministry: item.ministry,
              detail: projectInfo ?? undefined,
              budget: item.budgetAmount,
              execution: item.execAmount,
            }}
          /> : <p className="text-xs text-mirai-text-muted">{year}年度は予算要求の表示です。この年度の意見投稿・一覧はまだ対応していません。</p>}
        </div>

        {/* 政策評価の取得に失敗したときは黙って消さず、失敗したと分かるようにする */}
        {policyError && !policy && (
          <div className="px-6 py-2 border-b border-mirai-border text-xs text-destructive">
            政策評価を読み込めませんでした（{policyError}）
          </div>
        )}

        {/* 政策評価 — 推奨判断・改善アクションとその根拠 */}
        {policy && showPolicy && (
          <div className="px-6 py-3 border-b border-mirai-border bg-mirai-surface-teal/40">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <RecommendationBadge policy={policy} />
                {policy.improvementAction && <ActionBadge action={policy.improvementAction} />}
                {policy.policyCategoryLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-mirai-surface-light text-mirai-text-subtle">
                    {policy.policyCategoryLabel}
                  </span>
                )}
                {policy.overallPercentile != null && (
                  <span className="text-[10px] text-mirai-text-muted">
                    母集団内 上位{(100 - policy.overallPercentile).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 grid gap-3 sm:grid-cols-3 text-xs">
              <div>
                <div className="font-bold text-mirai-text-secondary">AI評価の生値（0-10）</div>
                <div className="mt-0.5 space-y-0.5 text-mirai-text-subtle font-mono text-[11px]">
                  <div>成果設計: {fmtRaw(policy.designClarity)}/10</div>
                  <div>検証可能性: {policy.evidenceReadiness != null ? `${fmtRaw(policy.evidenceReadiness)}/10` : '未評価'}</div>
                  <div>費用対内容: {policy.budgetProportionality != null ? `${fmtRaw(policy.budgetProportionality)}/10` : '未評価'}</div>
                  <div>必要性: {policy.necessity != null ? `${fmtRaw(policy.necessity)}/10` : '未評価'}</div>
                </div>
              </div>
              <div>
                <div className="font-bold text-mirai-text-secondary">執行透明性の内訳</div>
                <div className="mt-0.5 space-y-0.5 text-mirai-text-subtle font-mono text-[11px]">
                  <div>支出先の明確さ: {policy.identifiability ?? '—'}</div>
                  <div>使途の説明: {policy.purposeExplainability ?? '—'}</div>
                  <div className="text-mirai-text-muted">
                    収支の一致: {policy.budgetConsistency ?? '—'}（不算入・不一致フラグ）
                  </div>
                </div>
              </div>
              <div>
                <div className="font-bold text-mirai-text-secondary">
                  予算と執行
                  <span className="ml-1 font-normal text-mirai-text-muted">（総合点には不算入）</span>
                </div>
                <div className="mt-0.5 space-y-0.5 text-mirai-text-subtle font-mono text-[11px]">
                  {policy.executionRate != null ? (
                    <>
                      <div>執行率: {Math.round(policy.executionRate * 100)}%</div>
                      <div>翌年度繰越額: {item.carryoverToNext == null ? '未確認' : formatAmount(item.carryoverToNext)}</div>
                      <div>
                        不用額（繰越を除く）: {policy.unusedAmount == null ? '判定不能' : formatAmount(policy.unusedAmount)}
                        {policy.unusedRatio != null && `（${Math.round(policy.unusedRatio * 100)}%）`}
                      </div>
                    </>
                  ) : (
                    <div className="text-mirai-text-muted">執行実績なし（予備的経費・未着手のため評価対象外）</div>
                  )}
                  {policy.priorExecutionRate != null ? (
                    <div className="text-mirai-text-muted">
                      前年度: 執行率 {Math.round(policy.priorExecutionRate * 100)}%・
                      不用率 {policy.priorUnusedRatio == null ? '判定不能' : `${Math.round(policy.priorUnusedRatio * 100)}%`}
                    </div>
                  ) : (
                    <div className="text-mirai-text-muted">前年度: 実績なし（傾向は判定不能）</div>
                  )}
                  <div className={`font-sans ${UNUSED_TREND_META[policy.unusedTrend].cls}`}>
                    {UNUSED_TREND_META[policy.unusedTrend].label}
                  </div>
                  {policy.spendDownRisk && (
                    <div className="text-amber-600 font-sans">
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
                  <span className="font-bold text-mirai-text-secondary">{label}: </span>
                  <span className="text-mirai-text-subtle leading-relaxed">{text}</span>
                </div>
              ) : null)}
              {policy.recommendationReason && (
                <div>
                  <span className="font-bold text-mirai-text-secondary">推奨理由: </span>
                  <span className="text-mirai-text-subtle leading-relaxed">{policy.recommendationReason}</span>
                </div>
              )}
              <div className="text-[10px] leading-4 text-amber-700">{policy.provisionalReason}</div>
            </div>
          </div>
        )}

        {/* Axis detail (collapsible) */}
        {showAxisDetail && (
          <div className="border-b border-mirai-border divide-y divide-border">
            <div className="px-5 py-1.5 bg-mirai-surface-teal/60 text-[11px] text-mirai-text-muted">
              欠測した項目は重みごと除外して再正規化します（0点扱いにはしません）。
            </div>

            {/* AI が判定する4軸 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-bold text-mirai-text-secondary mb-1">
                AI が判定する4軸（0-10 → 10倍して0-100点）
                {isAi ? "" : <span className="ml-2 font-normal text-amber-600">この事業はヒューリスティック判定です</span>}
              </div>
              <div className="text-xs text-mirai-text-muted space-y-1">
                <div>
                  <span className="font-medium text-mirai-text-subtle">成果設計</span>
                  <span className="ml-1 text-mirai-text-muted">重み{WEIGHT_BY_KEY.designClarityScore}</span>:
                  誰のどんな課題をどの活動でどう改善するかが、概要文と登録されたロジックモデルの両方から特定できるか（実測成果ではない）
                  <div className="font-mono text-mirai-text-muted">
                    {fmtRaw(policy?.designClarity)}/10 → {policy?.designClarityScore ?? "—"}点
                  </div>
                  {policy?.findings.design && <div className="leading-relaxed">{policy.findings.design}</div>}
                </div>
                <div>
                  <span className="font-medium text-mirai-text-subtle">検証可能性</span>
                  <span className="ml-1 text-mirai-text-muted">重み{WEIGHT_BY_KEY.evidenceScore}</span>:
                  成果を第三者が後から検証できるか。登録された成果指標（目標値・実績値・出典）と概要文の数値記述の両方を見る
                  <div className="font-mono text-mirai-text-muted">
                    {policy?.evidenceReadiness != null
                      ? `${fmtRaw(policy.evidenceReadiness)}/10 → ${policy.evidenceScore}点`
                      : "未評価（重みごと除外して再正規化。0点扱いにはしない）"}
                  </div>
                  {policy?.findings.evidence && <div className="leading-relaxed">{policy.findings.evidence}</div>}
                </div>
                <div>
                  <span className="font-medium text-mirai-text-subtle">費用対内容</span>
                  <span className="ml-1 text-mirai-text-muted">重み{WEIGHT_BY_KEY.proportionalityScore}</span>:
                  金額が活動の規模に見合い、金が受益者に届いているか。支出先・再委託の実データを判定材料にするため、
                  所管庁の作文では動かしにくい軸として最も重く置いている
                  <div className="font-mono text-mirai-text-muted">
                    {policy?.budgetProportionality != null
                      ? `${fmtRaw(policy.budgetProportionality)}/10 → ${policy.proportionalityScore}点`
                      : "未評価（予算額が0の事業などは判定対象外）"}
                  </div>
                  {policy?.findings.proportionality && <div className="leading-relaxed">{policy.findings.proportionality}</div>}
                </div>
                <div>
                  <span className="font-medium text-mirai-text-subtle">必要性</span>
                  <span className="ml-1 text-mirai-text-muted">重み{WEIGHT_BY_KEY.necessityScore}</span>:
                  廃止したら誰が具体的に困るか、その手当てを他の手段で代替できるか。設計の巧拙とは独立に「そもそも要るのか」を問う
                  <div className="font-mono text-mirai-text-muted">
                    {policy?.necessity != null ? `${fmtRaw(policy.necessity)}/10 → ${policy.necessityScore}点` : "未評価"}
                  </div>
                  {policy?.findings.necessity && <div className="leading-relaxed">{policy.findings.necessity}</div>}
                </div>
              </div>
            </div>

            {/* 執行透明性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-bold text-mirai-text-secondary mb-1">
                執行透明性 = 支出先の明確さ×55 + 使途の説明×45
                <span className="ml-1 font-normal text-mirai-text-muted">（総合点への重み{WEIGHT_BY_KEY.executionTransparency}）</span>
                <span className="ml-2 font-mono font-normal text-mirai-text-muted">= {policy?.executionTransparency ?? "—"}点</span>
                {policy && policy.executionTransparency === null && (
                  <span className="ml-2 font-normal text-amber-600">
                    支出先データが1行も無いため未評価（0点扱いにはしません）
                  </span>
                )}
              </div>
              <div className="text-xs text-mirai-text-muted space-y-1">
                <div>
                  <span className="font-medium text-mirai-text-subtle">支出先の明確さ</span>
                  {isAi ? "（AI判定）" : "（ヒューリスティック）"}: 支出先が具体的に誰で、第三者が実在を確認できるか
                  <div className="flex gap-3 flex-wrap font-mono text-mirai-text-muted">
                    {item.identifyLevelAvg != null && <span>平均Lv {item.identifyLevelAvg.toFixed(2)}/3</span>}
                    <span className="text-green-600">valid {item.validCount}</span>
                    {item.govAgencyCount > 0 && <span className="text-emerald-500">行政機関 {item.govAgencyCount}</span>}
                    {item.suppValidCount > 0 && <span className="text-primary">補助 {item.suppValidCount}</span>}
                    <span className="text-red-500">invalid {item.invalidCount}</span>
                    {item.opaqueRatio != null && item.opaqueRatio > 0 && <span className="text-amber-500">不透明 {pct(item.opaqueRatio)}</span>}
                    <span>= {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : "—"}点</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium text-mirai-text-subtle">使途の説明</span>: 役割・契約概要から「何にいくら使ったか」が理解・検証できるか
                  <div className="font-mono text-mirai-text-muted">
                    {item.purposeLevelAvg != null && <span className="mr-3">平均Lv {item.purposeLevelAvg.toFixed(2)}/3</span>}
                    <span>= {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : "—"}点</span>
                  </div>
                </div>
                <div>
                  <span className="font-medium text-mirai-text-subtle">収支の一致</span>（機械計算・
                  <span className="text-amber-600">執行透明性には不算入</span>）:
                  執行額と実質支出が一致しているか。実測で9割の事業が満点になりほぼ定数だったため、
                  加重平均から外して「不一致フラグ」（60点未満）として判定ルールが直接見る形に降格した。
                  <div className="font-mono text-mirai-text-muted">
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
            <div className="px-5 py-2.5 bg-mirai-surface-gray">
              <div className="text-xs font-bold text-mirai-text-secondary mb-1">
                総合点 = {AXIS_META.map(a => `${a.label}×${a.weight}`).join(" + ")}
              </div>
              <div className="text-xs font-mono text-mirai-text-muted">
                {AXIS_META.map(a => {
                  const v = policy?.[a.key];
                  return (
                    <span key={a.key} className={v == null ? "text-amber-600" : undefined}>
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
              <div className="mt-1 text-[11px] leading-4 text-mirai-text-muted">
                費用対内容と必要性を厚くしているのは、この2軸だけが所管庁の作文が支配できない証拠
                （支出先の実績・予算執行）に基づくためです。よく書けた事業計画だけで上位に来ないようにしています。
              </div>
            </div>

            {/* 予算と執行（総合点に不算入） */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-bold text-mirai-text-secondary mb-1">
                予算と執行（総合点に不算入・縮小判定にのみ使用）
              </div>
              <div className="text-xs text-mirai-text-muted space-y-0.5">
                <div className="font-mono text-mirai-text-muted">
                  予算 {formatAmount(item.budgetAmount)} → 執行 {formatAmount(item.execAmount ?? 0)}
                  {policy?.executionRate != null
                    ? `／執行率 ${Math.round(policy.executionRate * 100)}%・不用額 ${policy.unusedAmount == null ? '判定不能' : formatAmount(policy.unusedAmount)}`
                    : "／執行実績なし（予備的経費・未着手のため評価対象外）"}
                </div>
                <div className="font-mono text-mirai-text-muted">
                  前年度: {policy?.priorExecutionRate != null
                    ? `執行率 ${Math.round(policy.priorExecutionRate * 100)}%・不用率 ${policy.priorUnusedRatio == null ? '判定不能' : `${Math.round(policy.priorUnusedRatio * 100)}%`}`
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
              <div className="text-xs font-bold text-mirai-text-secondary mb-1">ブロック構造（参考・スコアに不算入）</div>
              <div className="flex gap-3 flex-wrap text-xs font-mono text-mirai-text-muted">
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
          <div className="px-6 py-2.5 border-b border-mirai-border shrink-0 bg-mirai-surface-gray">
            <div className="flex items-center gap-3">
              <div className="text-xs font-bold text-mirai-text-secondary shrink-0">
                支出先一覧
                {recipients && (
                  <span className="ml-1.5 text-mirai-text-muted font-normal font-mono">
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
                  className="min-w-0 flex-1 px-3 py-1 text-xs border border-mirai-border rounded-md bg-card text-mirai-text placeholder:text-mirai-text-placeholder outline-none transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40"
                />
              )}
            </div>
          </div>

          {!recipientsAvailable && <div className="px-6 py-4 text-xs text-mirai-text-muted">{year}年度の支出先・執行実績は未収録です。予算要求の段階のため、この年度の支出先一覧は表示できません。事業概要と評価の元データは{sourceYear}年度のRSシートです。</div>}
          {recipientsAvailable && recipientsError && (
            <div className="px-6 py-4 text-xs text-mirai-text-muted">
              支出先を取得できませんでした。時間をおいて詳細を開き直してください。
            </div>
          )}
          {recipientsAvailable && !recipientsError && recipients === null && (
            <div className="px-6 py-4 flex items-center gap-2 text-xs text-mirai-text-muted">
              <Loader2 className="size-3 animate-spin text-mirai-text-muted" aria-hidden="true" />
              読み込み中...
            </div>
          )}
          {recipients && recipients.length === 0 && (
            <div className="px-6 py-4 text-xs text-mirai-text-muted">支出先データなし</div>
          )}
          {recipients && recipients.length > 0 && (
            <div>
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  {colWidths.map((w, i) => <col key={i} style={{ width: w, maxWidth: COL_MAX_WIDTHS[i] }} />)}
                </colgroup>
                <thead className="bg-mirai-surface sticky top-0 z-10">
                  <tr className="text-mirai-text-muted border-b border-mirai-border">
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
                        className={`px-3 py-2 font-bold whitespace-nowrap select-none relative ${col.sort ? 'cursor-pointer hover:text-mirai-text' : ''} text-${col.align}`}
                        onClick={col.sort ? () => handleRecipientSort(col.sort!) : undefined}
                        title={col.title}
                      >
                        <span className="truncate block overflow-hidden">{col.label}{col.sort && <RSortIcon field={col.sort} />}</span>
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary z-20"
                          onMouseDown={e => { e.preventDefault(); resizingCol.current = { index: ci, startX: e.clientX, startW: colWidths[ci] }; }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayedRecipients.map((row, i) => {
                    const sm = STATUS_META[row.s];
                    return (
                      <tr key={i} className="hover:bg-mirai-surface-teal/60 transition-colors">
                        <td className="px-4 py-1.5 text-mirai-text font-medium" title={row.n}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate flex-1">{row.n}</span>
                            {!row.o && <span className={`shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold ${sm.cls}`}>{sm.label}</span>}
                            {row.o && <span className="shrink-0 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800" title="不透明キーワードにマッチ">不透明</span>}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-mirai-text-muted truncate" title={row.chain}>
                          {row.chain
                            ? (row.chain.startsWith('組織→') ? row.chain.slice('組織→'.length) : row.chain)
                            : (row.b || '-')}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {(() => {
                            const cn = row.cn?.trim() ?? '';
                            if (!cn) return <span className="text-mirai-text-placeholder">—</span>;
                            // 有効な法人番号のみ gBizINFO へリンク（検証・URL構築は共有ヘルパーに集約）
                            // 番号はコピペ用に選択可能なテキストのままにし、リンクジャンプはアイコンクリック時のみ
                            const links = externalCorporateLinks(cn);
                            if (links) {
                              return (
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] leading-none text-mirai-text-subtle" title={cn}>
                                  <span className="select-text leading-none">{cn}</span>
                                  <a
                                    href={links.gbizinfo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 inline-flex items-center -mt-0.5 text-primary hover:text-primary-accent"
                                    title={`gBizINFO で法人番号を確認: ${cn}`}
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <Link2 className="block size-3" aria-hidden="true" />
                                  </a>
                                </span>
                              );
                            }
                            return (
                              <span
                                className="font-mono text-[10px] text-amber-700 font-bold"
                                title={`法人番号の形式が不正（誤記載の疑い）: ${cn}`}
                              >
                                {cn}<span className="ml-0.5">⚠</span>
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-mirai-text-secondary whitespace-nowrap">
                          {row.a2 === null ? <span className="text-mirai-text-placeholder">—</span> : formatAmount(row.a2)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-mirai-text-muted whitespace-nowrap">
                          {row.a2 !== null && row.a2 > 0 && item.spendNetTotal > 0
                            ? (() => { const p = row.a2 / item.spendNetTotal * 100; return p >= 1 ? `${p.toFixed(0)}%` : '<1%'; })()
                            : <span className="text-mirai-text-placeholder">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-mirai-text-muted truncate" title={row.role || undefined}>
                          {row.role || <span className="text-mirai-text-placeholder">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-mirai-text-subtle truncate" title={row.cc || undefined}>
                          {row.cc || <span className="text-mirai-text-placeholder">—</span>}
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
