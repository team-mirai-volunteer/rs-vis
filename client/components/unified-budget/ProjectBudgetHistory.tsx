'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import type { ProjectBudgetHistoryResponse } from '@/types/project-budget-history';
import { Button } from '@/components/ui/button';

const series = [
  { key: 'initialBudget', label: '当初予算', color: '#2563eb', dash: '5 3' },
  { key: 'totalBudget', label: '予算現額', color: '#9333ea', dash: undefined },
  { key: 'executedAmount', label: '執行額', color: '#059669', dash: undefined },
] as const;
const cache = new Map<number, ProjectBudgetHistoryResponse>();
const format = (amount: number | null) => amount === null ? '—' : formatBudgetFromYen(amount);

/**
 * グラフは実寸（px）で描く。viewBox で拡大すると幅の広いパネルで文字と高さが膨らみ、
 * 下の「予算・ブロック・支出先」タブの領域を圧迫するため、高さは固定にしている。
 */
const CHART_H = 96;
const PLOT_TOP = 6;
const PLOT_BOTTOM = 76;
const AXIS_LABEL_Y = 90;
const PLOT_LEFT = 66;
const PLOT_RIGHT_PAD = 14;

/** Mount with key={pid}, so changing projects cannot retain another project's selection/data. */
export function ProjectBudgetHistory({ pid }: { pid: number }) {
  const [data, setData] = useState(() => cache.get(pid));
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activeYear, setActiveYear] = useState<number | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () => setWidth(Math.max(200, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data]);
  useEffect(() => {
    const dismiss = () => setActiveYear(null);
    window.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (cache.has(pid)) { setData(cache.get(pid)); return; }
    setError(false);
    fetch(`/api/project-budget-history/${pid}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Failed to load history');
        return response.json() as Promise<ProjectBudgetHistoryResponse>;
      })
      .then(result => { cache.set(pid, result); setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [pid, attempt]);

  if (error) return <div className="py-3 text-xs" role="alert">予算の推移を取得できませんでした。<Button variant="link" className="ml-2 text-xs font-medium text-primary-accent" onClick={() => setAttempt(value => value + 1)}>再試行する</Button></div>;
  if (!data) return <p role="status" className="py-3 text-xs text-mirai-text-muted">予算の推移を読み込み中…</p>;
  if (data.points.length === 0) return <p className="py-3 text-xs text-mirai-text-muted">2025年版にこの事業の予算推移の記載はありません。</p>;

  const firstYear = data.points[0].fiscalYear;
  const lastYear = data.points[data.points.length - 1].fiscalYear;
  const points = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => data.points.find(point => point.fiscalYear === firstYear + i)
    ?? { fiscalYear: firstYear + i, initialBudget: null, totalBudget: null, executedAmount: null });
  const max = Math.max(1, ...points.flatMap(point => series.map(item => point[item.key] ?? 0)));
  const plotWidth = width - PLOT_LEFT - PLOT_RIGHT_PAD;
  const step = points.length === 1 ? plotWidth : plotWidth / (points.length - 1);
  const x = (index: number) => points.length === 1 ? PLOT_LEFT + plotWidth / 2 : PLOT_LEFT + index * step;
  const y = (amount: number) => PLOT_BOTTOM - amount / max * (PLOT_BOTTOM - PLOT_TOP);
  // 年度ラベルが重なる本数なら最新年度から数えて間引く（ヒット領域は全年度に残す）
  const labelEvery = Math.max(1, Math.ceil(28 / step));
  const active = points.find(point => point.fiscalYear === activeYear);

  return <section className="py-2" aria-label="予算・執行額の推移">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold text-mirai-text">予算・執行額の推移</h3>
      <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-mirai-text-muted hover:underline" title={`RS ${data.sheetYear}年版の訂正を含む記載値。取得日：${new Date(data.retrievedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })}。予算現額は補正・繰越等を含みます。`}>出典 ↗</a>
    </div>
    <div ref={chartRef} className="relative mt-1" onMouseLeave={() => setActiveYear(null)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setActiveYear(null); } }}>
    <svg width={width} height={CHART_H} viewBox={`0 0 ${width} ${CHART_H}`} className="block" role="group" aria-label={`${firstYear}〜${lastYear}年度の予算・執行額。グラフに触れると金額を表示します。`}>
      {[0, 0.5, 1].map(ratio => <g key={ratio}>
        <line x1={PLOT_LEFT} x2={width - PLOT_RIGHT_PAD} y1={y(max * ratio)} y2={y(max * ratio)} stroke="currentColor" className="text-mirai-border" />
        <text x={PLOT_LEFT - 5} y={y(max * ratio) + 3} textAnchor="end" fontSize={9} fill="currentColor" className="text-mirai-text-muted">{formatBudgetFromYen(max * ratio)}</text>
      </g>)}
      {series.map(item => {
        let previous = false;
        const path = points.map((point, i) => {
          const value = point[item.key];
          if (value === null) { previous = false; return ''; }
          const command = `${previous ? 'L' : 'M'}${x(i)},${y(value)}`;
          previous = true;
          return command;
        }).join(' ');
        return <g key={item.key}>
          <path d={path} fill="none" stroke={item.color} strokeWidth={1.5} strokeDasharray={item.dash} />
          {points.map((point, i) => point[item.key] !== null && <circle key={point.fiscalYear} cx={x(i)} cy={y(point[item.key]!)} r={point.fiscalYear === activeYear ? 3.5 : 2} fill={item.color} />)}
        </g>;
      })}
      {points.map((point, i) => <g key={point.fiscalYear}>
        {(points.length - 1 - i) % labelEvery === 0 && <text x={x(i)} y={AXIS_LABEL_Y} textAnchor="middle" fontSize={9} fill="currentColor" className="text-mirai-text-muted">{point.fiscalYear}</text>}
        <rect x={points.length === 1 ? PLOT_LEFT : i === 0 ? PLOT_LEFT - 8 : x(i) - step / 2} y={0} width={points.length === 1 ? plotWidth : (i === 0 || i === points.length - 1) ? step / 2 + 8 : step} height={CHART_H} fill="transparent"
          tabIndex={0} role="button" aria-label={`${point.fiscalYear}年度の金額`} aria-describedby={activeYear === point.fiscalYear ? `budget-history-tooltip-${pid}` : undefined}
          onPointerMove={event => { setPointer({ x: event.clientX, y: event.clientY }); setActiveYear(point.fiscalYear); }}
          onFocus={event => { const bounds = event.currentTarget.getBoundingClientRect(); setPointer({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }); setActiveYear(point.fiscalYear); }}
          onBlur={() => setActiveYear(null)} onClick={event => { if (event.detail > 0) setPointer({ x: event.clientX, y: event.clientY }); setActiveYear(point.fiscalYear); }}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveYear(point.fiscalYear); } }} />
      </g>)}
    </svg>
    <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] text-mirai-text-secondary">
      {series.map(item => <span key={item.key} className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block w-3 border-t-2" style={{ borderColor: item.color, borderStyle: item.dash ? 'dashed' : 'solid' }} />{item.label}</span>)}
    </div>
    {active && createPortal(<div id={`budget-history-tooltip-${pid}`} role="tooltip" className="pointer-events-none fixed z-[100] w-[180px] rounded-md border border-border bg-card p-2 text-[11px] shadow-lg"
      style={{ left: `clamp(8px, ${pointer.x - 90}px, calc(100vw - 188px))`, top: pointer.y - 16, transform: 'translateY(-100%)' }}>
      <p className="mb-1 font-bold text-mirai-text">{active.fiscalYear}年度</p>
      {series.map(item => <div key={item.key} className="flex justify-between gap-2"><span style={{ color: item.color }}>{item.label}</span><span className="tabular-nums text-mirai-text">{active[item.key] === null ? (item.key === 'executedAmount' && active.fiscalYear >= data.sheetYear ? '未確定' : '未記載') : format(active[item.key])}</span></div>)}
    </div>, document.body)}
    </div>
  </section>;
}
