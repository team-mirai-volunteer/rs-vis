'use client';

import { useId, useMemo } from 'react';
import type { BurdenResult, TaxParameters, TaxState } from '@/types/tax-burden';
import { HOUSEHOLDS } from '@/app/lib/tax-burden/households';
import { curveSeries } from '@/app/lib/tax-burden/simulate';

const COLORS = ['var(--primary-accent)', 'var(--stance-neutral)', 'var(--mirai-text)',
  'var(--primary)', 'var(--mirai-reaction-active)', 'var(--mirai-text-subtle)'];
const DASHES = ['', '7 3', '2 3', '', '10 3 2 3', '5 4'];

export function CurveChart({ state, params, onIncomeChange }: {
  state: TaxState; params: TaxParameters; onIncomeChange: (income: number) => void;
}) {
  const id = useId().replace(/:/g, '');
  const series = useMemo(() => HOUSEHOLDS.filter(h => state.showAll || h.id === state.household).map(h => ({
    household: h, points: curveSeries(state, params, h.id), index: HOUSEHOLDS.findIndex(x => x.id === h.id),
  })), [state, params]);
  const reform = useMemo(() => state.view === 'reform' ? curveSeries(state, params, state.household, state.reform) : null, [state, params]);
  const valid = [...series.flatMap(s => s.points), ...(reform ?? [])].filter(p => !p.outOfScope && p.netRate !== null);
  const minY = Math.min(-0.1, Math.floor(Math.min(...valid.map(p => p.netRate!)) * 10) / 10);
  const maxY = Math.max(0.4, Math.ceil(Math.max(...valid.map(p => p.netRate!)) * 10) / 10);
  const tickStep = Math.max(0.1, Math.ceil((maxY - minY) / 8 * 10) / 10);
  const ticks = Array.from({ length: Math.floor((maxY - minY) / tickStep + 0.001) + 1 }, (_, i) => minY + i * tickStep);
  const left = 65, top = 30, width = 735, height = 270;
  const x = (income: number) => left + income / 20000000 * width;
  const y = (rate: number) => top + (maxY - rate) / (maxY - minY) * height;
  const path = (points: BurdenResult[], outOfScope: boolean) => {
    let pen = false;
    return points.map(p => {
      if (p.outOfScope !== outOfScope || p.netRate === null) { pen = false; return ''; }
      const command = pen ? 'L' : 'M'; pen = true;
      return `${command}${x(p.income).toFixed(2)},${y(p.netRate).toFixed(2)}`;
    }).join(' ');
  };
  return (
    <div>
      <p className="mb-2 text-xs text-mirai-text-secondary">縦軸：純負担率（税・本人保険料 − 現金給付）÷ 世帯年収</p>
      <p className="mb-2 text-xs text-mirai-text-subtle sm:hidden">グラフは左右にスクロールできます。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="世帯負担カーブ（左右にスクロール可能）">
      {/* SVG is the data chart, not an icon. Icons elsewhere use lucide-react. */}
      <svg viewBox="0 0 830 360" className="w-full min-w-[640px]" role="img" aria-labelledby={`${id}-title ${id}-desc`}
        onPointerDown={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width * 830;
          onIncomeChange(Math.max(0, Math.min(20000000, Math.round((px - left) / width * 20000000 / 10000) * 10000)));
        }}>
        <title id={`${id}-title`}>世帯年収別の純負担率・試作</title>
        <desc id={`${id}-desc`}>線の種類と色で世帯類型を区別します。薄い線はモデル適用範囲外です。数値は下の年収入力と負担内訳表でも確認できます。</desc>
        <defs><clipPath id={`${id}-clip`}><rect x={left} y={top} width={width} height={height} /></clipPath></defs>
        {ticks.map(rate => (
          <g key={rate}>
            <line x1={left} x2={left + width} y1={y(rate)} y2={y(rate)} stroke="var(--mirai-border)" strokeDasharray="3 5" />
            <text x={left - 12} y={y(rate) + 4} textAnchor="end" fontSize="12" fill="var(--mirai-text-secondary)">{Math.round(rate * 100)}%</text>
          </g>
        ))}
        <line x1={left} x2={left + width} y1={y(0)} y2={y(0)} stroke="var(--mirai-text-subtle)" />
        {[0, 400, 800, 1200, 1600, 2000].map(v => (
          <text key={v} x={x(v * 10000)} y={top + height + 24} textAnchor="middle" fontSize="12" fill="var(--mirai-text-secondary)">{v.toLocaleString('ja-JP')}</text>
        ))}
        <text x={left + width} y={350} textAnchor="end" fontSize="12" fill="var(--mirai-text-secondary)">世帯年収（万円）</text>
        <g clipPath={`url(#${id}-clip)`} fill="none">
          {series.map(({ household, points, index }) => <g key={household.id} stroke={COLORS[index]} strokeDasharray={DASHES[index]}>
            <path d={path(points, true)} strokeWidth="2" opacity="0.2" />
            <path d={path(points, false)} strokeWidth={household.id === state.household ? 3.5 : 1.8} opacity={household.id === state.household ? 1 : 0.7} />
          </g>)}
          {reform && <><path d={path(reform, false)} stroke="var(--primary-accent)" strokeDasharray="9 5" strokeWidth="4" />
            <path d={path(reform, true)} stroke="var(--primary-accent)" strokeDasharray="9 5" strokeWidth="3" opacity="0.2" /></>}
          <line x1={x(state.income)} x2={x(state.income)} y1={top} y2={top + height} stroke="var(--mirai-text)" strokeDasharray="4 4" />
        </g>
      </svg>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-mirai-text-secondary">
        {series.map(({ household, index }) => <span key={household.id} className="inline-flex items-center gap-2">
          <svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke={COLORS[index]} strokeWidth="3" strokeDasharray={DASHES[index]} /></svg>
          {household.label}
        </span>)}
        {reform && <span className="font-bold text-primary-accent">太い破線：選択世帯の改革案</span>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">薄線は就労者の給与がフルタイム下限未満の参考計算です。縦軸の範囲を超える参考値は図の外に出ます。年収を選ぶと内訳で確認できます。</p>
    </div>
  );
}
