'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { QualityScoreItem, QualityScoresResponse } from '@/app/api/quality-scores/route';
import type { RecipientRow } from '@/app/api/quality-scores/recipients/route';
import type { ProjectDetail } from '@/types/project-details';

const PAGE_SIZE = 50;

type SortField = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisStructure' | 'axisEffective'
  | 'budgetAmount' | 'execAmount' | 'spendTotal' | 'spendNetTotal' | 'redelegationDepth' | 'rowCount' | 'pid' | 'name';
type SortDir = 'asc' | 'desc';

const STATUS_META: Record<RecipientRow['s'], { label: string; cls: string }> = {
  valid:   { label: 'OK',      cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  gov:     { label: '行政機関', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' },
  supp:    { label: '補助辞書', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  invalid: { label: '不一致',  cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  unknown: { label: '未登録',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};

function ScoreDetailDialog({ item, onClose, year }: { item: QualityScoreItem; onClose: () => void; year: string }) {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [recipientSortField, setRecipientSortField] = useState<'chain' | 'b' | 's' | 'c' | 'o' | 'a2' | 'pct'>('chain');
  const [recipientSortDir, setRecipientSortDir] = useState<'asc' | 'desc'>('asc');
  const [showAxisDetail, setShowAxisDetail] = useState(false);
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

  useEffect(() => {
    setRecipients(null);
    setRecipientsError(false);
    setRecipientSearch('');
    setRecipientSortField('chain');
    setRecipientSortDir('asc');
    setShowAxisDetail(false);
    setProjectInfo(undefined);
    setShowProjectInfo(true);
    fetch(`/api/quality-scores/recipients?pid=${item.pid}&year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((rows: RecipientRow[]) => setRecipients(rows))
      .catch(() => setRecipientsError(true));
    fetch(`/api/project-details/${item.pid}?year=${year}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then((d: ProjectDetail) => setProjectInfo(d))
      .catch(() => setProjectInfo(null));
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

  const axes = [
    { key: 'axisIdentify', label: 'A: 特定可能性', weight: 28, score: item.axisIdentify ?? null },
    { key: 'axisPurpose', label: 'B: 使途の説明性', weight: 22, score: item.axisPurpose ?? null },
    { key: 'axisBudget', label: 'C: 収支の整合性', weight: 15, score: item.axisBudget ?? null },
    { key: 'axisEffective', label: 'E: 有効性', weight: 35, score: item.axisEffective ?? null },
    { key: 'axisStructure', label: 'D: 構造(参考)', weight: 0, score: item.axisStructure ?? null },
  ] as const;
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none shrink-0 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">×</button>
        </div>

        {/* Score summary — single compact row */}
        <div className="px-6 py-2.5 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-4">
            {/* Score badge */}
            <div className="shrink-0 text-center">
              <div className={`text-2xl font-bold font-mono leading-none ${scoreColor(item.totalScore)}`}>
                {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
              </div>
              <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">総合</div>
            </div>
            {/* Divider */}
            <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 shrink-0" />
            {/* Axis scores — horizontal row */}
            <div className="flex items-center gap-3 shrink-0">
              {axes.map(a => (
                <div key={a.key} className="text-center">
                  <div className={`text-xs font-bold font-mono leading-none ${scoreColor(a.score)}`}>
                    {a.score !== null ? a.score.toFixed(0) : '-'}
                  </div>
                  <div className="text-[8px] text-gray-400 mt-0.5 whitespace-nowrap">{a.label.replace(/^[A-D]: /, '')}</div>
                </div>
              ))}
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
          <div className="mt-1 flex items-center gap-4">
            <button
              onClick={() => setShowProjectInfo(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showProjectInfo ? '▲ 事業内容を閉じる' : '▼ 事業内容'}
            </button>
            <button
              onClick={() => setShowAxisDetail(d => !d)}
              className="text-[11px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {showAxisDetail ? '▲ 計算根拠を閉じる' : '▼ スコア計算根拠'}
            </button>
          </div>
        </div>

        {/* 事業内容（目的・現状課題・概要）— 有効性軸の判定材料 */}
        {showProjectInfo && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0 overflow-y-auto max-h-60 bg-gray-50/60 dark:bg-gray-800/40">
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

        {/* Axis detail (collapsible) */}
        {showAxisDetail && (
          <div className="border-b border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 shrink-0 overflow-y-auto max-h-72">
            <div className="px-5 py-1.5 bg-violet-50/60 dark:bg-violet-900/20 text-[11px] text-gray-500 dark:text-gray-400">
              軸A・Bは{isAi ? 'AIが' : 'ヒューリスティックが'}支出先ごとに特定可能性・使途を判定し金額加重で集計。軸C・Dは機械計算。
            </div>

            {/* Axis A: 特定可能性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">A: 支出先の特定可能性（重み28%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>支出先が具体的に誰で、第三者が実在を確認できるか（名称・法人番号有無・契約概要を総合判定）</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.identifyLevelAvg != null && <span>平均レベル: {item.identifyLevelAvg.toFixed(2)}/3</span>}
                  <span className="text-green-600 dark:text-green-400">valid: {item.validCount}</span>
                  {item.govAgencyCount > 0 && <span className="text-emerald-500">行政機関: {item.govAgencyCount}</span>}
                  {item.suppValidCount > 0 && <span className="text-blue-500">補助: {item.suppValidCount}</span>}
                  <span className="text-red-500">invalid: {item.invalidCount}</span>
                  {item.opaqueRatio != null && item.opaqueRatio > 0 && <span className="text-amber-500">不透明: {pct(item.opaqueRatio)}</span>}
                  <span>= {item.axisIdentify != null ? item.axisIdentify.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis B: 使途の説明性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">B: 使途の説明性（重み22%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>役割・契約概要から「何にいくら使ったか」が理解・検証できるか</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.purposeLevelAvg != null && <span>平均レベル: {item.purposeLevelAvg.toFixed(2)}/3</span>}
                  <span>= {item.axisPurpose != null ? item.axisPurpose.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis C: 収支整合性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">C: 収支の整合性（重み15%・機械計算）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>予算額: {formatAmount(item.budgetAmount)}</span>
                  <span>執行額: {formatAmount(item.execAmount)}</span>
                  <span>実質支出: {formatAmount(item.spendNetTotal)}</span>
                </div>
                <div className="font-mono text-gray-400">
                  執行 vs 実質支出 乖離 {pct(item.gapRatio)}（10%まで満点の許容バンド）→ {item.axisBudget != null ? item.axisBudget.toFixed(1) : '-'}点
                </div>
              </div>
            </div>

            {/* Axis D: 構造整合性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">D: 構造の整合性（参考・総合に不算入・機械計算）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div className="flex gap-3 flex-wrap">
                  <span>ブロック数: {item.blockCount}</span>
                  {item.orphanBlockCount > 0 && <span className="text-orange-500">孤立: {item.orphanBlockCount}</span>}
                  {item.hasRedelegation && <span className="text-gray-400">再委託深度: {item.redelegationDepth}（減点せず参考）</span>}
                </div>
                <div className="flex gap-2 flex-wrap font-mono text-gray-400">
                  <span>基礎100 − ブロック金額不整合 − 孤立ブロック</span>
                  <span>= {item.axisStructure != null ? item.axisStructure.toFixed(1) : '-'}点</span>
                </div>
              </div>
            </div>

            {/* Axis E: 有効性 */}
            <div className="px-5 py-2.5">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">E: 有効性／成果設計の明確さ（重み35%・{isAi ? 'AI' : 'ヒューリスティック'}判定）</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                <div>事業の目的・現状課題・概要から、国民生活への寄与がどれだけ明確・妥当に説明されているか（※実測成果ではなく成果設計の明確さ）</div>
                <div className="flex gap-3 flex-wrap font-mono text-gray-400">
                  {item.effectiveLevel != null && <span>レベル: {item.effectiveLevel}/10</span>}
                  <span>= {item.axisEffective != null ? item.axisEffective.toFixed(1) : '-'}点</span>
                </div>
                {item.effectiveReason && item.effectiveReason !== 'heuristic' && (
                  <div className="text-gray-500 dark:text-gray-400">根拠: {item.effectiveReason}</div>
                )}
              </div>
            </div>

            {/* Weighted sum */}
            <div className="px-5 py-2 bg-gray-50 dark:bg-gray-800">
              <div className="text-xs font-mono text-gray-400">
                {axes.filter(a => a.score !== null && a.weight > 0).map(a => `${a.score!.toFixed(1)}×${a.weight}`).join(' + ')}
                {' '}= <span className={`font-bold ${scoreColor(item.totalScore)}`}>{item.totalScore?.toFixed(1)}</span>点
              </div>
            </div>
          </div>
        )}

        {/* Recipients */}
        <div className="flex flex-col flex-1 min-h-0">
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
            <div className="overflow-y-auto flex-1">
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

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-400 text-xs">-</span>;
  const w = Math.max(0, Math.min(100, score));
  let bg = 'bg-red-400';
  if (score >= 90) bg = 'bg-green-400';
  else if (score >= 70) bg = 'bg-blue-400';
  else if (score >= 50) bg = 'bg-yellow-400';
  return (
    <div className="flex items-center gap-1">
      <div className="w-8 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`text-xs font-mono ${scoreColor(score)}`}>{score.toFixed(0)}</span>
    </div>
  );
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

type ScoreRange = 'all' | '0-9' | '10-19' | '20-29' | '30-39' | '40-49' | '50-59' | '60-69' | '70-79' | '80-89' | '90-99' | '100-100';

type DistMetric = 'totalScore' | 'axisIdentify' | 'axisPurpose' | 'axisBudget' | 'axisEffective';
const DIST_METRICS: { key: DistMetric; label: string }[] = [
  { key: 'totalScore', label: '総合' },
  { key: 'axisIdentify', label: '特定可能性' },
  { key: 'axisPurpose', label: '使途説明性' },
  { key: 'axisBudget', label: '収支整合性' },
  { key: 'axisEffective', label: '有効性' },
];

export default function QualityPage() {
  const [year, setYear] = useState<'2024' | '2025'>('2025');
  const [data, setData] = useState<QualityScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMinistry, setSelectedMinistry] = useState<string>('');
  const [scoreRange, setScoreRange] = useState<ScoreRange>('all');
  const [distMetric, setDistMetric] = useState<DistMetric>('totalScore');
  const [amountFilters, setAmountFilters] = useState<Record<string, { min: string; max: string }>>({
    budgetAmount: { min: '', max: '' },
    execAmount: { min: '', max: '' },
    spendTotal: { min: '', max: '' },
    spendNetTotal: { min: '', max: '' },
  });
  const [sortField, setSortField] = useState<SortField>('spendNetTotal');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
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

  const filtered = useMemo<QualityScoreItem[]>(() => {
    if (!data) return [];
    let items = data.items;

    if (selectedMinistry) {
      items = items.filter(i => i.ministry === selectedMinistry);
    }

    if (scoreRange !== 'all') {
      const [lo, hi] = scoreRange.split('-').map(Number);
      items = items.filter(i => {
        const s = i[distMetric] as number | null | undefined;
        if (s === null || s === undefined) return false;
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

    for (const [field, { min, max }] of Object.entries(amountFilters)) {
      const minVal = parseAmountInput(min);
      const maxVal = parseAmountInput(max);
      if (minVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) >= minVal);
      if (maxVal !== null) items = items.filter(i => (i[field as keyof QualityScoreItem] as number) <= maxVal);
    }

    items = [...items].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'pid') {
        cmp = parseInt(a.pid) - parseInt(b.pid);
      } else {
        const av = a[sortField];
        const bv = b[sortField];
        if (typeof av === 'string' && typeof bv === 'string') {
          cmp = av.localeCompare(bv, 'ja');
        } else {
          cmp = ((av as number) ?? -1) - ((bv as number) ?? -1);
        }
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return items;
  }, [data, selectedMinistry, scoreRange, distMetric, searchQuery, amountFilters, sortField, sortDir]);

  // Reset page on filter change
  const amountFilterKey = Object.values(amountFilters).map(f => `${f.min}-${f.max}`).join(',');
  const filterKey = `${selectedMinistry}|${scoreRange}|${distMetric}|${searchQuery}|${amountFilterKey}|${sortField}|${sortDir}`;
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
      setSortDir(field === 'name' || field === 'pid' ? 'asc' : 'asc');
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {dialogItem && <ScoreDetailDialog item={dialogItem} onClose={() => setDialogItem(null)} year={year} />}
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-4">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
              ← トップ
            </Link>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">
              事業別 支出先データ品質スコア
            </h1>
            <select
              value={year}
              onChange={e => setYear(e.target.value as '2024' | '2025')}
              className="ml-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 cursor-pointer"
            >
              <option value="2025">2025年度</option>
              <option value="2024">2024年度</option>
            </select>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {summary.total.toLocaleString()}事業 / 平均 {summary.avgScore.toFixed(1)} / 中央値 {summary.medianScore.toFixed(1)} / 最頻値 {summary.modeScore}
          </p>
        </div>
      </div>

      {/* Score distribution summary (10-point bins) + histogram */}
      <div className="max-w-[1600px] mx-auto px-4 py-3">
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
          const metricVal = (i: QualityScoreItem) => i[distMetric] as number | null | undefined;
          const counts = binRanges.map(({ lo, hi }) =>
            data.items.filter(i => { const s = metricVal(i); return s != null && s >= lo && s <= hi; }).length
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
                  const h = Math.max(2, Math.round((count / maxCount) * 48));
                  const { bar } = binColor(lo);
                  const isActive = scoreRange === range;
                  return (
                    <button
                      key={range}
                      onClick={() => setScoreRange(isActive ? 'all' : range)}
                      className={`flex flex-col items-center transition-all ${isActive ? 'ring-1 ring-blue-500 rounded' : ''}`}
                      title={`${label}点: ${count}件`}
                    >
                      <span className="text-[9px] font-mono text-gray-500 mb-0.5">{count || ''}</span>
                      <div className={`w-5 rounded-sm ${bar}`} style={{ height: `${h}px` }} />
                      <span className="text-[8px] font-mono text-gray-400 mt-0.5">{label}</span>
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
                  className={`rounded-lg px-3 py-1.5 text-center transition-all ${
                    scoreRange === 'all'
                      ? 'ring-2 ring-blue-500 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:opacity-100 opacity-80'
                  }`}
                >
                  <div className="text-[10px] font-medium">全件</div>
                  <div className="text-sm font-bold">{summary.total.toLocaleString()}</div>
                </button>
              </div>
              <div className="flex flex-col gap-1.5 self-end flex-1 min-w-[200px]">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="事業名・PID・組織名で検索..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <select
                    value={selectedMinistry}
                    onChange={e => setSelectedMinistry(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">全府省庁</option>
                    {summary.ministries.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {([
                    { key: 'budgetAmount', label: '予算' },
                    { key: 'execAmount', label: '執行' },
                    { key: 'spendTotal', label: '支出計' },
                    { key: 'spendNetTotal', label: '実質' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-0.5 shrink-0">
                      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap mr-0.5">{label}</span>
                      <input
                        type="text"
                        placeholder="下限"
                        title="下限 (例: 100億, 1兆)"
                        value={amountFilters[key].min}
                        onChange={e => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], min: e.target.value } }))}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      <span className="text-gray-400 mx-0.5">〜</span>
                      <input
                        type="text"
                        placeholder="上限"
                        title="上限 (例: 1兆, 5000億)"
                        value={amountFilters[key].max}
                        onChange={e => setAmountFilters(prev => ({ ...prev, [key]: { ...prev[key], max: e.target.value } }))}
                        className="w-16 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                      {(amountFilters[key].min || amountFilters[key].max) && (
                        <button
                          onClick={() => setAmountFilters(prev => ({ ...prev, [key]: { min: '', max: '' } }))}
                          className="ml-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {filtered.length.toLocaleString()}件表示
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Table */}
      <div className="max-w-[1600px] mx-auto px-4 pb-8">
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left cursor-pointer whitespace-nowrap" onClick={() => handleSort('pid')}>
                  PID<SortIcon field="pid" />
                </th>
                <th className="px-2 py-2 text-left cursor-pointer min-w-[200px]" onClick={() => handleSort('name')}>
                  事業名<SortIcon field="name" />
                </th>
                <th className="px-2 py-2 text-left whitespace-nowrap">府省庁</th>
                <th className="px-2 py-2 text-left whitespace-nowrap">局・庁</th>
                <th className="px-2 py-2 text-center whitespace-nowrap">支出先</th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('totalScore')}>
                  総合<SortIcon field="totalScore" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisIdentify')} title="A: 支出先の特定可能性（AI判定 28%）">
                  特定可能性<SortIcon field="axisIdentify" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisPurpose')} title="B: 使途の説明性（AI判定 22%）">
                  使途説明性<SortIcon field="axisPurpose" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisBudget')} title="C: 収支の整合性（機械計算 15%）">
                  収支整合性<SortIcon field="axisBudget" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisEffective')} title="E: 有効性／成果設計の明確さ（AI判定 35%・意図ベース）">
                  有効性<SortIcon field="axisEffective" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('budgetAmount')}>
                  予算額<SortIcon field="budgetAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('execAmount')}>
                  執行額<SortIcon field="execAmount" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('spendTotal')}>
                  支出先合計<SortIcon field="spendTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('spendNetTotal')}>
                  実質支出額<SortIcon field="spendNetTotal" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('redelegationDepth')}>
                  再委託階層<SortIcon field="redelegationDepth" />
                </th>
                <th className="px-2 py-2 text-right cursor-pointer whitespace-nowrap" onClick={() => handleSort('rowCount')}>
                  支出先数<SortIcon field="rowCount" />
                </th>
                <th className="px-2 py-2 text-center cursor-pointer whitespace-nowrap" onClick={() => handleSort('axisStructure')} title="構造の整合性: ブロック金額の整合・孤立ブロック有無（総合スコアには不算入の参考）">
                  構造<SortIcon field="axisStructure" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageItems.map(item => (
                <React.Fragment key={item.pid}>
                  <tr
                    className="hover:bg-blue-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                    onClick={() => setExpandedRow(expandedRow === item.pid ? null : item.pid)}
                  >
                    <td className="px-2 py-1.5 font-mono text-gray-500">{item.pid}</td>
                    <td className="px-2 py-1.5 text-gray-900 dark:text-white truncate max-w-[300px]" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.ministry}</td>
                    <td className="px-2 py-1.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">{item.bureau || '-'}</td>
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      <button
                        onClick={e => { e.stopPropagation(); setDialogItem(item); }}
                        className="px-2 py-1 text-[11px] font-medium rounded-md border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 transition-colors"
                        title="支出先一覧・スコア計算根拠を表示"
                      >
                        詳細
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={`font-bold ${scoreColor(item.totalScore)}`}>
                        {item.totalScore !== null ? item.totalScore.toFixed(1) : '-'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisIdentify ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisPurpose ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisBudget ?? null} /></td>
                    <td className="px-2 py-1.5"><ScoreBar score={item.axisEffective ?? null} /></td>
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
                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                      {item.axisStructure == null
                        ? <span className="text-gray-300 dark:text-gray-600">-</span>
                        : item.axisStructure >= 100
                          ? <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200">整合</span>
                          : <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200" title={`構造スコア ${item.axisStructure}（金額不整合・孤立ブロック）`}>不整合</span>}
                    </td>
                  </tr>
                  {expandedRow === item.pid && (
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={17} className="px-4 py-3">
                        <div>{item.name}</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-xs">
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">組織</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>府省庁: {item.ministry}</div>
                              <div>局・庁: {item.bureau || '-'}</div>
                              <div>部: {item.division || '-'}</div>
                              <div>課: {item.section || '-'}</div>
                              <div>室: {item.office || '-'}</div>
                              <div>班: {item.team || '-'}</div>
                              <div>係: {item.unit || '-'}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">特定可能性・使途（{item.aiSource && item.aiSource !== 'heuristic' ? 'AI' : 'ヒューリスティック'}）</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              {item.identifyLevelAvg != null && <div>特定可能性 平均Lv: {item.identifyLevelAvg.toFixed(2)}/3 → {item.axisIdentify != null ? item.axisIdentify.toFixed(0) : '-'}点</div>}
                              {item.purposeLevelAvg != null && <div>使途説明性 平均Lv: {item.purposeLevelAvg.toFixed(2)}/3 → {item.axisPurpose != null ? item.axisPurpose.toFixed(0) : '-'}点</div>}
                              <div>valid: {item.validCount}{item.govAgencyCount > 0 && <span className="text-green-600"> (+行政{item.govAgencyCount})</span>}{item.suppValidCount > 0 && <span className="text-blue-500"> (+補助{item.suppValidCount})</span>} / invalid: {item.invalidCount}</div>
                              <div>法人番号記入: {item.cnFilled} / 未記入: {item.cnEmpty}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">有効性（{item.aiSource && item.aiSource !== 'heuristic' ? 'AI' : 'ヒューリスティック'}）</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>レベル: {item.effectiveLevel ?? '-'}/10 → {item.axisEffective != null ? `${item.axisEffective.toFixed(0)}点` : '-'}</div>
                              {item.effectiveReason && item.effectiveReason !== 'heuristic'
                                ? <div className="text-gray-500 dark:text-gray-400 leading-relaxed">根拠: {item.effectiveReason}</div>
                                : <div className="text-gray-400">根拠: なし（ヒューリスティック）</div>}
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">予算・支出</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>予算額: {formatAmount(item.budgetAmount)}</div>
                              <div>執行額: {formatAmount(item.execAmount)}</div>
                              <div>支出先合計（全ブロック）: {formatAmount(item.spendTotal)}</div>
                              <div>実質支出額（ルートのみ）: {formatAmount(item.spendNetTotal)}</div>
                              <div>乖離率（実質 vs 執行）: {pct(item.gapRatio)}</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">ブロック構造</h4>
                            <div className="space-y-0.5 text-gray-600 dark:text-gray-400">
                              <div>ブロック数: {item.blockCount}{item.orphanBlockCount > 0 && <span className="text-red-500"> (孤立: {item.orphanBlockCount})</span>}</div>
                              <div>再委託: {item.hasRedelegation ? `あり (階層${item.redelegationDepth})` : 'なし'}</div>
                              <div>不透明支出比: {pct(item.opaqueRatio)}</div>
                              <div className="text-[10px] text-gray-400">（不透明キーワード辞書にマッチする支出先への支出額の割合）</div>
                              <div>支出先行数: {item.rowCount}</div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              前へ
            </button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              次へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
