import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CAPACITY_DATA, CAPACITY_SOURCES, calibrateCapacity, type CapacityCalibration as Settings } from '@/app/lib/fiscal-space/capacity-calibration';
import { productionIndex } from '@/app/lib/fiscal-space/production';
import type { Inputs, ModelParameters } from '@/types/fiscal-space';
import { RangeField } from './Controls';
import { money, percent } from './format';

export function CapacityCalibration({ value, onChange, inputs, parameters, realGdp, gap }: {
  value: Settings; onChange: (value: Settings) => void; inputs: Inputs; parameters: ModelParameters; realGdp: number; gap: number;
}) {
  const result = calibrateCapacity(value, inputs, 1 + gap / 100);
  const ratio = productionIndex(result.estimated, parameters) / (1 + gap / 100);
  const manualRatio = productionIndex(inputs, parameters) / (1 + gap / 100);
  const fields = [
    ['unemployedRealization', '失業者の就業実現割合', 100, 100, 5, '%'],
    ['potentialRealization', '潜在労働力人口の参加実現割合', 100, 100, 5, '%'],
    ['newWorkerHours', '新たに就業する人の週労働時間', 1, 40, 1, '時間'],
    ['extraWeeklyHours', '追加就労希望者の週追加時間', 1, 20, 1, '時間'],
    ['manufacturingWeight', '設備余力の全産業への換算割合', 100, 100, 5, '%'],
    ['equipmentRecovery', '設備の参照水準までの回復割合', 100, 100, 5, '%'],
  ] as const;
  return <Card id="capacity-calibration"><CardHeader>
    <h2 className="text-lg font-bold">最大GDPの根拠を設定する</h2>
    <p className="text-sm">労働の未活用人数・就業時間と製造業の稼働率から、労働・設備の投入指数を参考校正します。2024年の統計に、就業や稼働回復がどこまで実現するかの仮定を加えます。</p>
    <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="sr-only">最大GDPの投入指数の設定方法</legend>{([
      ['manual', '投入指数を直接設定'], ['estimated', '統計からの参考校正を使う'],
    ] as const).map(([mode, label]) => <label key={mode} className="flex items-center gap-2"><input type="radio" name="capacity-calibration-mode" value={mode} checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />{label}</label>)}</fieldset>
  </CardHeader><CardContent className="space-y-4">
    <dl className="grid gap-3 sm:grid-cols-3 text-sm">
      <div><dt>参考校正した労働投入</dt><dd className="text-lg font-bold tabular-nums">{result.estimated.labour.toFixed(4)}倍</dd></div>
      <div><dt>参考校正した設備投入</dt><dd className="text-lg font-bold tabular-nums">{result.estimated.capital.toFixed(4)}倍</dd></div>
      <div data-testid="calibrated-maximum-gap"><dt>参考校正時の年0・最大GDPギャップ</dt><dd className="text-lg font-bold tabular-nums">{percent(1 / ratio - 1)}</dd><dd className="text-xs">最大GDP {money(realGdp * ratio, 1)}。直接設定では{percent(1 / manualRatio - 1)}。</dd></div>
    </dl>
    <p className="text-xs">{value.mode === 'estimated' ? '参考校正を計算に反映中。' : '現在は直接設定で計算中。上の参考校正を選ぶと結果・制約判定に反映します。'} エネルギー・中間財は既存の投入指数を使います。統計の人数を将来の雇用予測へ加算するものではありません。</p>
    <details><summary className="cursor-pointer text-sm font-bold">統計と実現条件を確認・調整</summary><div className="mt-3 space-y-4">
      <p className="text-xs">労働力調査・2024年：延週間就業時間23.72億時間（平均36.3時間）、失業者195万人、潜在労働力人口33万人、追加就労希望就業者190万人。失業者は1か月以内の求職者で、基本集計の完全失業者とは範囲が異なります。<a href={CAPACITY_SOURCES.hours} target="_blank" rel="noreferrer" className="underline">就業時間の出典</a> / <a href={CAPACITY_SOURCES.people} target="_blank" rel="noreferrer" className="underline">未活用労働の出典（2024年比較値・6頁）</a></p>
      <p className="text-xs">製造工業の稼働率指数：2024年 {CAPACITY_DATA.equipmentIndex}、参照する2022年 {CAPACITY_DATA.equipmentReference}（ともに2020年＝100、2025年10月資料の年平均原指数）。100はフル稼働ではありません。非製造業には同じ余力を仮定せず、換算割合を置きます。<a href={CAPACITY_SOURCES.equipment} target="_blank" rel="noreferrer" className="underline">設備の出典</a></p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label, scale, max, step, unit]) => <RangeField key={key} label={label} value={value[key] * scale} min={0} max={max} step={step} unit={unit} onChange={n => onChange({ ...value, [key]: n / scale })} />)}</div>
      <div className="space-y-2 text-xs">
        <p>労働投入＝1＋（失業者の追加時間＋潜在労働力人口の追加時間＋追加就労希望者の追加時間）÷延週間就業時間。追加就労希望者はすでに就業しているため、人数を新規就業者として二重加算しません。</p>
        <p>設備投入＝1＋（108.1÷101.4−1）×回復割合×全産業への換算割合。換算割合20%は設定値で、製造業のGDP比をそのまま設備投入の重みにした実測推計ではありません。参照年の水準も物理的な最大値ではありません。</p>
        <p>両基準データで2024年の余力比率を使用します。職種・地域・技能の適合、非製造業の設備、輸入中間財・エネルギーの全国供給上限は未校正。労働・設備の余力比率は実質GDP÷潜在GDPを掛けて投入指数へ換算します。結果は仮定付きの参考能力で、公式GDPギャップや持続可能な最大GDPの推定値ではありません。</p>
      </div>
    </div></details>
  </CardContent></Card>;
}
