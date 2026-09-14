'use client';

import { useId, useMemo } from 'react';
import type { BurdenResult, ConsumptionDataset, OecdDataset, TaxParameters, TaxState } from '@/types/tax-burden';
import { HOUSEHOLDS } from '@/app/lib/tax-burden/households';
import { curveSeries } from '@/app/lib/tax-burden/simulate';

const COLORS = ['var(--primary-accent)', 'var(--stance-neutral)', 'var(--mirai-text)',
  'var(--primary)', 'var(--mirai-reaction-active)', 'var(--mirai-text-subtle)'];
const DASHES = ['', '7 3', '2 3', '', '10 3 2 3', '5 4'];

export function CurveChart({ state, params, consumption, oecd, onIncomeChange }: {
  state: TaxState; params: TaxParameters; consumption: ConsumptionDataset | null; oecd: OecdDataset | null; onIncomeChange: (income: number) => void;
}) {
  const id = useId().replace(/:/g, '');
  const rateOf = (p: BurdenResult) => state.includeConsumption ? p.netRateWithConsumption : p.netRate;
  const series = useMemo(() => HOUSEHOLDS.filter(h => state.showAll || h.id === state.household).map(h => ({
    household: h, points: curveSeries(state, params, h.id, undefined, consumption), index: HOUSEHOLDS.findIndex(x => x.id === h.id),
  })), [state, params, consumption]);
  const reform = useMemo(() => state.view === 'reform' ? curveSeries(state, params, state.household, state.reform, consumption) : null, [state, params, consumption]);
  const oecdYear = oecd?.years['2025'];
  const oecdPoints = state.showOecd && oecdYear?.averageWageJpy
    ? oecdYear.points.filter(pt => series.some(s => s.household.id === pt.household)).map(pt => ({ ...pt, income: oecdYear.averageWageJpy! * pt.awRatioTotal }))
    : [];
  const valid = [...series.flatMap(s => s.points), ...(reform ?? [])].filter(p => !p.outOfScope && rateOf(p) !== null).map(p => rateOf(p)!);
  const oecdValues = oecdPoints.flatMap(pt => [pt.min, pt.max, pt.oecdAverage]).map(v => v / 100);
  const minY = Math.min(-0.1, Math.floor(Math.min(...valid, ...oecdValues) * 10) / 10);
  const maxY = Math.max(0.4, Math.ceil(Math.max(...valid, ...oecdValues) * 10) / 10);
  const tickStep = Math.max(0.1, Math.ceil((maxY - minY) / 8 * 10) / 10);
  const ticks = Array.from({ length: Math.floor((maxY - minY) / tickStep + 0.001) + 1 }, (_, i) => minY + i * tickStep);
  const left = 65, top = 30, width = 735, height = 270;
  const x = (income: number) => left + income / 20000000 * width;
  const y = (rate: number) => top + (maxY - rate) / (maxY - minY) * height;
  const path = (points: BurdenResult[], outOfScope: boolean) => {
    let pen = false;
    return points.map(p => {
      const rate = rateOf(p);
      if (p.outOfScope !== outOfScope || rate === null) { pen = false; return ''; }
      const command = pen ? 'L' : 'M'; pen = true;
      return `${command}${x(p.income).toFixed(2)},${y(rate).toFixed(2)}`;
    }).join(' ');
  };
  return (
    <div>
      <p className="mb-2 text-xs text-mirai-text-secondary">縦軸：純負担率（税・本人保険料{state.includeConsumption ? '・消費税推計' : ''} − 現金給付）÷ 世帯年収</p>
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
        <desc id={`${id}-desc`}>線の種類と色で世帯類型を区別します。薄い線はモデル適用範囲外です。OECDの定点は縦線が最小〜最大、ひし形が平均、丸がOECD計算の日本値です。数値は下の負担内訳表でも確認できます。</desc>
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
          {oecdPoints.map(pt => {
            const color = COLORS[HOUSEHOLDS.findIndex(h => h.id === pt.household)];
            const cx = x(pt.income);
            return <g key={`${pt.household}-${pt.awRatioTotal}`} stroke={color} fill={color}>
              <line x1={cx} x2={cx} y1={y(pt.max / 100)} y2={y(pt.min / 100)} strokeWidth="2" opacity="0.6" />
              <line x1={cx - 6} x2={cx + 6} y1={y(pt.max / 100)} y2={y(pt.max / 100)} strokeWidth="2" opacity="0.6" />
              <line x1={cx - 6} x2={cx + 6} y1={y(pt.min / 100)} y2={y(pt.min / 100)} strokeWidth="2" opacity="0.6" />
              <path d={`M${cx},${y(pt.oecdAverage / 100) - 7} l7,7 l-7,7 l-7,-7 z`} />
              {pt.japan !== null && <circle cx={cx} cy={y(pt.japan / 100)} r="5" fill="var(--card)" strokeWidth="2" />}
              <title>{`${HOUSEHOLDS.find(h => h.id === pt.household)!.label}・平均賃金比${Math.round(pt.awRatioTotal * 100)}%：OECD平均${pt.oecdAverage.toFixed(1)}%、最小${pt.min.toFixed(1)}%（${pt.minCountry}）、最大${pt.max.toFixed(1)}%（${pt.maxCountry}）、日本${pt.japan?.toFixed(1)}%`}</title>
            </g>;
          })}
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
        {oecdPoints.length > 0 && <span>縦線：OECD加盟{oecdPoints[0].countries}か国の最小〜最大、◆平均、○OECD計算の日本（2025、消費税を含まない）</span>}
      </div>
      {oecdPoints.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left">OECD定点</th><th scope="col" className="text-right">世帯年収</th><th scope="col" className="text-right">日本</th><th scope="col" className="text-right">OECD平均</th><th scope="col" className="text-right">最小</th><th scope="col" className="text-right">最大</th></tr></thead>
        <tbody>{oecdPoints.map(pt => <tr key={`${pt.household}-${pt.awRatioTotal}`} className="border-t border-mirai-border/30"><th scope="row" className="py-1 text-left font-normal">{HOUSEHOLDS.find(h => h.id === pt.household)!.label}・AW{Math.round(pt.awRatioTotal * 100)}%</th><td className="text-right">{Math.round(pt.income / 10000).toLocaleString('ja-JP')}万円</td><td className="text-right">{pt.japan?.toFixed(1)}%</td><td className="text-right">{pt.oecdAverage.toFixed(1)}%</td><td className="text-right">{pt.min.toFixed(1)}%（{pt.minCountry}）</td><td className="text-right">{pt.max.toFixed(1)}%（{pt.maxCountry}）</td></tr>)}</tbody></table></div>}
      <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">薄線は就労者の給与がフルタイム下限未満の参考計算です。縦軸の範囲を超える参考値は図の外に出ます。{state.includeConsumption && '消費税は家計調査（二人以上の勤労者世帯）の年収十分位別支出構成からの推計で、単身世帯にも同じ構成比を当てています。'}</p>
    </div>
  );
}
