'use client';

import { useId, useMemo } from 'react';
import type { BurdenResult, ConsumptionDataset, IncidenceDataset, OecdDataset, TaxParameters, TaxState } from '@/types/tax-burden';
import { HOUSEHOLDS, isReformed } from '@/app/lib/tax-burden/households';
import { curveSeries } from '@/app/lib/tax-burden/simulate';

// One colour per household. 単身 used to take --primary-accent (#0f8472), which reads the same as the
// --primary (#2aa693) of 片働き夫婦・子2人 when both are solid lines, so it gets a violet of its own.
const COLORS = ['rgb(126, 87, 194)', 'var(--stance-neutral)', 'var(--mirai-text)',
  'var(--primary)', 'var(--mirai-reaction-active)', 'var(--mirai-text-subtle)'];
const DASHES = ['', '7 3', '2 3', '', '10 3 2 3', '5 4'];
const OECD_BAND = 'rgba(80, 120, 200, 0.16)';
const OECD_LINE = 'rgb(60, 100, 190)';
const OECD_JAPAN = 'rgb(200, 90, 60)';

export function CurveChart({ state, params, consumption, oecd, incidence, onIncomeChange }: {
  state: TaxState; params: TaxParameters; consumption: ConsumptionDataset | null; oecd: OecdDataset | null;
  incidence: IncidenceDataset | null; onIncomeChange: (income: number) => void;
}) {
  const id = useId().replace(/:/g, '');
  const rateOf = (p: BurdenResult) => state.includeConsumption ? p.netRateWithConsumption : p.netRate;
  // In OECD comparison mode the chart focuses on the selected household, as the Okina curve does.
  const showAll = state.showAll && !state.showOecd;
  const series = useMemo(() => HOUSEHOLDS.filter(h => showAll || h.id === state.household).map(h => ({
    household: h, points: curveSeries(state, params, h.id, undefined, consumption, incidence), index: HOUSEHOLDS.findIndex(x => x.id === h.id),
  })), [state, params, consumption, incidence, showAll]);
  const reform = useMemo(() => isReformed(state.reform) ? curveSeries(state, params, state.household, state.reform, consumption, incidence) : null, [state, params, consumption, incidence]);
  const curve = state.showOecd ? oecd?.curves[state.household] ?? null : null;
  const oecdYear = oecd?.years['2025'];
  // OECD publishes dual-earner couples only at fixed earnings points (100+67% and 100+100% of the average wage), never as a curve.
  const points = state.showOecd && !curve && oecdYear?.averageWageJpy
    ? oecdYear.points.filter(pt => pt.household === state.household).map(pt => ({ ...pt, income: oecdYear.averageWageJpy! * pt.awRatioTotal }))
    : [];
  const oecdMissing = state.showOecd && oecd && !curve && points.length === 0;
  const valid = [...series.flatMap(s => s.points), ...(reform ?? [])].filter(p => !p.outOfScope && rateOf(p) !== null).map(p => rateOf(p)!);
  const oecdValues = (curve ? [...curve.min, ...curve.max, ...curve.oecdAverage] : points.flatMap(pt => [pt.min, pt.max, pt.oecdAverage])).map(v => v / 100);
  // One deeply negative household (ひとり親 just above the wage requirement) would otherwise squash the whole chart,
  // so the axis stops at -50% and anything beyond is clipped, as the note says.
  const minY = Math.max(-0.5, Math.min(-0.1, Math.floor(Math.min(...valid, ...oecdValues) * 10) / 10));
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
  const oecdX = (i: number) => x(curve!.averageWageJpy * curve!.awRatio[i]);
  const linePath = (values: (number | null)[]) => values.map((v, i) => v === null ? '' : `${i === 0 || values[i - 1] === null ? 'M' : 'L'}${oecdX(i).toFixed(2)},${y(v / 100).toFixed(2)}`).join(' ');
  const bandPath = curve ? `${curve.max.map((v, i) => `${i === 0 ? 'M' : 'L'}${oecdX(i).toFixed(2)},${y(v / 100).toFixed(2)}`).join(' ')} ${[...curve.min].reverse().map((v, j) => `L${oecdX(curve.min.length - 1 - j).toFixed(2)},${y(v / 100).toFixed(2)}`).join(' ')} Z` : '';
  const householdLabel = HOUSEHOLDS.find(h => h.id === state.household)!.label;
  const nearestOecd = curve ? curve.awRatio.reduce((best, r, i) => Math.abs(curve.averageWageJpy * r - state.income) < Math.abs(curve.averageWageJpy * curve.awRatio[best] - state.income) ? i : best, 0) : -1;
  return (
    <div>
      <p className="mb-2 text-xs text-mirai-text-secondary">縦軸：純負担率（税・本人保険料{state.includeConsumption ? '・消費税推計' : ''}{state.corporateShare > 0 ? '・法人税の転嫁' : ''} − 現金給付）÷ 世帯年収</p>
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
        <desc id={`${id}-desc`}>線の種類と色で世帯類型を区別します。薄い線はモデル適用範囲外です。OECD比較では、青い帯がOECD加盟国の最小〜最大、青い破線がOECD平均、細い橙の線がOECD計算の日本値です。数値は下の負担内訳表でも確認できます。</desc>
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
          {curve && <>
            <path d={bandPath} fill={OECD_BAND} stroke="none" />
            <path d={linePath(curve.oecdAverage)} stroke={OECD_LINE} strokeWidth="3" strokeDasharray="8 4" />
            <path d={linePath(curve.japan)} stroke={OECD_JAPAN} strokeWidth="1.5" />
            {[0.5, 1, 1.5, 2, 2.5].map(r => <text key={r} x={x(curve.averageWageJpy * r)} y={top + 12} textAnchor="middle" fontSize="10" fill={OECD_LINE}>AW{Math.round(r * 100)}%</text>)}
          </>}
          {points.map(pt => {
            const cx = x(pt.income);
            return <g key={pt.awRatioTotal}>
              <g stroke={OECD_LINE} fill={OECD_LINE}>
                <line x1={cx} x2={cx} y1={y(pt.max / 100)} y2={y(pt.min / 100)} strokeWidth="2" opacity="0.55" />
                <line x1={cx - 6} x2={cx + 6} y1={y(pt.max / 100)} y2={y(pt.max / 100)} strokeWidth="2" opacity="0.55" />
                <line x1={cx - 6} x2={cx + 6} y1={y(pt.min / 100)} y2={y(pt.min / 100)} strokeWidth="2" opacity="0.55" />
                <path d={`M${cx},${y(pt.oecdAverage / 100) - 7} l7,7 l-7,7 l-7,-7 z`} stroke="none" />
              </g>
              {pt.japan !== null && <circle cx={cx} cy={y(pt.japan / 100)} r="5" fill="var(--card)" stroke={OECD_JAPAN} strokeWidth="2" />}
              <text x={cx} y={top + 12} textAnchor="middle" fontSize="10" fill={OECD_LINE}>AW{Math.round(pt.awRatioTotal * 100)}%</text>
              <title>{`${householdLabel}・${pt.principal.replace('AW', '')}％＋${pt.spouse.replace('AW', '')}％：OECD平均${pt.oecdAverage.toFixed(1)}%、最小${pt.min.toFixed(1)}%（${pt.minCountry}）、最大${pt.max.toFixed(1)}%（${pt.maxCountry}）、日本${pt.japan?.toFixed(1)}%`}</title>
            </g>;
          })}
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
          {household.label}{curve ? '（本試作の計算）' : ''}
        </span>)}
        {reform && <span className="font-bold text-primary-accent">太い破線：選択世帯の改革案</span>}
        {curve && <>
          <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="10"><rect x="0" y="0" width="24" height="10" fill={OECD_BAND} /></svg>OECD加盟{curve.countries[0]}か国の最小〜最大</span>
          <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke={OECD_LINE} strokeWidth="3" strokeDasharray="8 4" /></svg>OECD平均</span>
          <span className="inline-flex items-center gap-2"><svg aria-hidden="true" width="24" height="8"><line x1="0" x2="24" y1="4" y2="4" stroke={OECD_JAPAN} strokeWidth="1.5" /></svg>日本（OECD計算）</span>
        </>}
        {points.length > 0 && <span>縦線：OECD加盟{points[0].countries}か国の最小〜最大、◆OECD平均、○OECD計算の日本（共働きは定点のみ）</span>}
      </div>
      {curve && nearestOecd >= 0 && <div className="mt-3 grid gap-2 rounded-xl bg-mirai-surface p-3 text-xs sm:grid-cols-4">
        <div><span className="block text-mirai-text-secondary">選択年収に最も近いOECD点</span><span className="font-bold tabular-nums">AW{Math.round(curve.awRatio[nearestOecd] * 100)}%＝{Math.round(curve.averageWageJpy * curve.awRatio[nearestOecd] / 10000).toLocaleString('ja-JP')}万円</span></div>
        <div><span className="block text-mirai-text-secondary">日本（OECD計算）</span><span className="font-bold tabular-nums">{curve.japan[nearestOecd]?.toFixed(1)}%</span></div>
        <div><span className="block text-mirai-text-secondary">OECD平均</span><span className="font-bold tabular-nums">{curve.oecdAverage[nearestOecd].toFixed(1)}%</span></div>
        <div><span className="block text-mirai-text-secondary">最小〜最大</span><span className="font-bold tabular-nums">{curve.min[nearestOecd].toFixed(1)}%（{curve.minCountry[nearestOecd]}）〜{curve.max[nearestOecd].toFixed(1)}%（{curve.maxCountry[nearestOecd]}）</span></div>
      </div>}
      {points.length > 0 && <div className="mt-3 rounded-xl bg-mirai-surface p-3">
        <p className="mb-2 text-xs leading-relaxed text-mirai-text-secondary"><strong>共働きはOECDに連続系列が無く、公表されている定点だけを表示しています。</strong>括弧内はOECDが置いている夫婦の収入按分です。本試作のカーブは左パネルの按分（{state.share}:{100 - state.share}）で計算しているので、按分を合わせると同じ条件の比較になります。</p>
        <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left">OECDの定点</th><th scope="col" className="text-right">世帯年収</th><th scope="col" className="text-right">日本</th><th scope="col" className="text-right">OECD平均</th><th scope="col" className="text-right">最小</th><th scope="col" className="text-right">最大</th></tr></thead>
          <tbody>{points.map(pt => <tr key={pt.awRatioTotal} className="border-t border-mirai-border/30">
            <th scope="row" className="py-1 text-left font-normal">平均賃金比 {pt.principal.replace('AW', '')}％＋{pt.spouse.replace('AW', '')}％{pt.suggestedShare !== null && `（按分${pt.suggestedShare}:${100 - pt.suggestedShare}）`}</th>
            <td className="text-right">{Math.round(pt.income / 10000).toLocaleString('ja-JP')}万円</td>
            <td className="text-right font-bold">{pt.japan?.toFixed(1)}%</td><td className="text-right">{pt.oecdAverage.toFixed(1)}%</td>
            <td className="text-right">{pt.min.toFixed(1)}%（{pt.minCountry}）</td><td className="text-right">{pt.max.toFixed(1)}%（{pt.maxCountry}）</td>
          </tr>)}</tbody></table></div>
      </div>}
      {oecdMissing && <p role="status" className="mt-3 rounded-xl border border-mirai-border bg-card px-4 py-3 text-xs">「{householdLabel}」に対応するOECDの公表値がありません。家族構成を変えるとOECD比較を表示します。</p>}
      <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">薄線は就労者の給与が被用者保険の賃金要件（年{Math.round(params.employeeInsuranceThreshold / 10000)}万円、フルタイムの最低賃金なら年{Math.round(params.minimumAnnualWage / 10000).toLocaleString('ja-JP')}万円）に届かない帯です。ここでは厚生年金・健康保険ではなく国民年金（所得が低ければ申請免除）と国民健康保険で計算しますが、生活保護・無保険・被扶養者のどれになるかで実際の負担は大きく変わるため参考値として薄く描いています。これより上は被用者保険に入るので計算が確定します。縦軸の範囲を超える値は図の外に出ます。この境目で保険料が段差になるのが「106万円の壁」です。年収がごく低い側で負担率がまた上がっていくのは、国民健康保険の均等割が所得に関わらず人数分かかるためで、軽減は最大7割、単身でも年約{Math.round((params.lifecycle.nationalHealth.basicPerCapita + params.lifecycle.nationalHealth.supportPerCapita + params.lifecycle.nationalHealth.carePerCapita) * 0.3 / 1000) / 10}万円が残ります。実際にはこの水準は生活保護の対象になり国保の適用から外れますが、本モデルは生活保護を扱っていません。{curve && `OECDの帯と線は Taxing Wages ${curve.year}（平均賃金比50〜250%、日本の平均賃金 ${Math.round(curve.averageWageJpy / 10000).toLocaleString('ja-JP')}万円）。消費税・事業主負担を含まない。OECD平均は${curve.averageSource.startsWith('OECD aggregate') ? 'OECD公表の集計値' : '加盟国の単純平均'}。`}{points.length > 0 && `OECDの定点は Taxing Wages 2025（日本の平均賃金 ${Math.round(oecdYear!.averageWageJpy! / 10000).toLocaleString('ja-JP')}万円）で、平均は加盟${points[0].countries}か国の単純平均。消費税・事業主負担を含まない。`}{state.includeConsumption && '消費税は家計調査（二人以上の勤労者世帯）の年収十分位別支出構成からの推計で、単身世帯にも同じ構成比を当てています。'}</p>
    </div>
  );
}
