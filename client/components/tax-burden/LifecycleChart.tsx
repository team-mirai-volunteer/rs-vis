'use client';

import { useId } from 'react';
import type { LifecycleYear, TaxState } from '@/types/tax-burden';
import { LIFECYCLE_END, LIFECYCLE_START } from '@/app/lib/tax-burden/simulate-lifecycle';
import { DENOMINATOR_LABEL, yearRate } from '@/app/lib/tax-burden/heatmap-items';

const PHASE_LABEL: Record<LifecycleYear['phase'], string> = { work: '現役', reemployed: '継続雇用', 'work-pension': '就労＋年金', pension: '年金' };

export function LifecycleChart({ years, base, state, selectedAge, onSelectAge }: {
  years: LifecycleYear[]; base?: LifecycleYear[] | null; state: TaxState; selectedAge: number; onSelectAge: (age: number) => void;
}) {
  const id = useId().replace(/:/g, '');
  const rateOf = (y: LifecycleYear) => yearRate(y, state.denominator, state.includeConsumption);
  const rates = [...years, ...(base ?? [])].map(rateOf).filter((v): v is number => v !== null && Number.isFinite(v));
  const minY = Math.min(-0.1, Math.floor(Math.min(...rates) * 10) / 10);
  const maxY = Math.max(0.4, Math.ceil(Math.max(...rates) * 10) / 10);
  const left = 65, top = 34, width = 735, height = 220;
  const x = (age: number) => left + (age - LIFECYCLE_START) / (LIFECYCLE_END - LIFECYCLE_START) * width;
  const y = (rate: number) => top + (maxY - rate) / (maxY - minY) * height;
  const maxMoney = Math.max(...years.map(y => Math.max(y.income, y.disposable)), 1);
  const top2 = top + height + 80, height2 = 150;
  const y2 = (v: number) => top2 + (1 - v / maxMoney) * height2;
  const line = (pick: (y: LifecycleYear) => number | null, outOfScope: boolean, scale: (v: number) => number, series: LifecycleYear[] = years) => {
    let pen = false;
    return series.map(yr => {
      const v = pick(yr);
      if (yr.outOfScope !== outOfScope || v === null || !Number.isFinite(v)) { pen = false; return ''; }
      const c = pen ? 'L' : 'M'; pen = true;
      return `${c}${x(yr.ageAt).toFixed(2)},${scale(v).toFixed(2)}`;
    }).join(' ');
  };
  const boundaries = [40, 60, 65, 75].map(age => ({ age, label: { 40: '介護保険（第2号）', 60: '継続雇用', 65: '年金開始・国保', 75: '後期高齢者医療' }[age] }));
  const totalHeight = top2 + height2 + 44;
  const ticks = Array.from({ length: Math.round((maxY - minY) / 0.1) + 1 }, (_, i) => minY + i * 0.1);
  return <div>
    <p className="mb-2 text-xs text-mirai-text-secondary">上：{state.denominator === 'career'
      ? `（税・本人保険料${state.includeConsumption ? '・消費税推計' : ''} − 現金給付 − 公的年金の受給）÷ 現役期の世帯年収。年金は負担のマイナスとして扱うため、受給期は負の値（受け取り超過）になる。`
      : `（税・本人保険料${state.includeConsumption ? '・消費税推計' : ''} − 現金給付）÷ その年の総収入（給与＋年金）。年金は分母に入る。`}下：総収入と現金ベースの可処分所得（年額）。法人税の転嫁推計と消費税は可処分所得から控除しません。</p>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="年齢別の負担率と可処分所得（左右にスクロール可能）">
      <svg viewBox={`0 0 830 ${totalHeight}`} className="w-full min-w-[640px]" role="img" aria-labelledby={`${id}-title`}
        onPointerDown={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width * 830;
          onSelectAge(Math.max(LIFECYCLE_START, Math.min(LIFECYCLE_END, Math.round(LIFECYCLE_START + (px - left) / width * (LIFECYCLE_END - LIFECYCLE_START)))));
        }}>
        <title id={`${id}-title`}>年齢別の純負担率と可処分所得・試作</title>
        <text x={left} y={top - 12} fontSize="12" fill="var(--mirai-text)" fontWeight="bold">純負担率（{DENOMINATOR_LABEL[state.denominator]}・%）</text>
        <text x={left} y={top2 - 12} fontSize="12" fill="var(--mirai-text)" fontWeight="bold">金額（年額・万円）</text>
        {[[top, height], [top2, height2]].map(([t, h]) => <g key={t} stroke="var(--mirai-text-subtle)">
          <line x1={left} x2={left} y1={t} y2={t + h} />
          <line x1={left} x2={left + width} y1={t + h} y2={t + h} />
        </g>)}
        {[20, 30, 40, 50, 60, 65, 70, 75, 80, 85].map(a => <text key={`age1-${a}`} x={x(a)} y={top + height + 18} textAnchor="middle" fontSize="12" fill="var(--mirai-text-secondary)">{a}</text>)}
        {ticks.map(rate => <g key={rate}>
          <line x1={left} x2={left + width} y1={y(rate)} y2={y(rate)} stroke="var(--mirai-border)" strokeDasharray="3 5" />
          <text x={left - 12} y={y(rate) + 4} textAnchor="end" fontSize="12" fill="var(--mirai-text-secondary)">{Math.round(rate * 100)}%</text>
        </g>)}
        <line x1={left} x2={left + width} y1={y(0)} y2={y(0)} stroke="var(--mirai-text-subtle)" />
        {boundaries.map(b => <g key={b.age}>
          <line x1={x(b.age)} x2={x(b.age)} y1={top} y2={top2 + height2} stroke="var(--mirai-text-subtle)" strokeDasharray="2 4" />
          <text x={x(b.age) + 4} y={top + 12} fontSize="11" fill="var(--mirai-text-subtle)">{b.age}歳 {b.label}</text>
        </g>)}
        {base && <path d={line(rateOf, false, y, base) + ' ' + line(rateOf, true, y, base)} fill="none" stroke="var(--mirai-text-subtle)" strokeWidth="2" />}
        <path d={line(rateOf, true, y)} fill="none" stroke="var(--primary-accent)" strokeWidth="2" opacity="0.2" />
        <path d={line(rateOf, false, y)} fill="none" stroke="var(--primary-accent)" strokeWidth="3.5" strokeDasharray={base ? '9 5' : undefined} />
        {[0, 0.5, 1].map(f => <g key={f}>
          <line x1={left} x2={left + width} y1={y2(maxMoney * f)} y2={y2(maxMoney * f)} stroke="var(--mirai-border)" strokeDasharray="3 5" />
          <text x={left - 12} y={y2(maxMoney * f) + 4} textAnchor="end" fontSize="12" fill="var(--mirai-text-secondary)">{Math.round(maxMoney * f / 10000).toLocaleString('ja-JP')}万</text>
        </g>)}
        <path d={line(yr => yr.income, false, y2) + ' ' + line(yr => yr.income, true, y2)} fill="none" stroke="var(--mirai-text)" strokeWidth="2" strokeDasharray="6 3" />
        <path d={line(yr => yr.disposable, false, y2) + ' ' + line(yr => yr.disposable, true, y2)} fill="none" stroke="var(--primary)" strokeWidth="3" />
        {[20, 30, 40, 50, 60, 65, 70, 75, 80, 85].map(a => <text key={a} x={x(a)} y={top2 + height2 + 22} textAnchor="middle" fontSize="12" fill="var(--mirai-text-secondary)">{a}</text>)}
        <text x={left + width} y={totalHeight - 4} textAnchor="end" fontSize="12" fill="var(--mirai-text-secondary)">年齢（歳）</text>
        <line x1={x(selectedAge)} x2={x(selectedAge)} y1={top} y2={top2 + height2} stroke="var(--mirai-text)" strokeDasharray="4 4" />
      </svg>
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-mirai-text-secondary">
      <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--primary-accent)" strokeWidth="3" strokeDasharray={base ? '9 5' : undefined} /></svg>{base ? '改革案の' : ''}純負担率（{state.denominator === 'career' ? '年金差し引き・' : ''}{DENOMINATOR_LABEL[state.denominator]}）</span>
      {base && <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--mirai-text-subtle)" strokeWidth="2" /></svg>基準制度</span>}
      <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--mirai-text)" strokeWidth="2" strokeDasharray="6 3" /></svg>総収入（給与＋年金）</span>
      <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke="var(--primary)" strokeWidth="3" /></svg>可処分所得</span>
      <span>選択中：{selectedAge}歳（{PHASE_LABEL[years.find(y => y.ageAt === selectedAge)?.phase ?? 'work']}）。図をクリックで年齢を選べます。</span>
    </div>
  </div>;
}

export { PHASE_LABEL };
