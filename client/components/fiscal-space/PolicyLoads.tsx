import type { Policy, PolicyLoad, ProjectLoadBasis } from '@/types/fiscal-space';
import { EMPTY_PROJECT_BASIS, effectiveLoad, loadCoverage } from '@/app/lib/fiscal-space/policy-load';
import { SECTOR_LABELS, TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { RangeField } from './Controls';
import { RESOURCE_PROFILE_NOTES } from '@/app/lib/fiscal-space/resource-estimate';
import { fieldClass, percent } from './format';

function NullableNumber({ label, value, onChange, min = 0, max = 1e7, step = .1, unit }: {
  label: string; value: number | null; onChange: (v: number | null) => void;
  min?: number; max?: number; step?: number; unit: string;
}) {
  return <label className="block space-y-1 text-sm">
    <span>{label}（{unit}）</span>
    <input type="number" className={fieldClass} value={value ?? ''} min={min} max={max} step={step}
      placeholder="未評価" onChange={e => {
        if (e.target.value === '') onChange(null);
        else if (Number.isFinite(e.target.valueAsNumber)) onChange(Math.max(min, Math.min(max, e.target.valueAsNumber)));
      }} />
  </label>;
}

function LoadFields({ policy, value, onChange }: {
  policy: Policy; value: PolicyLoad; onChange: (load: PolicyLoad) => void;
}) {
  const current = effectiveLoad(value);
  const changeBasis = <K extends keyof ProjectLoadBasis>(key: K, n: ProjectLoadBasis[K]) => {
    onChange({ ...value, basis: { ...EMPTY_PROJECT_BASIS, ...value.basis, [key]: n } });
  };
  const basis = value.basis;
  return <div className="mt-3 space-y-4">
    <label className="block text-sm">{policy.name}・負荷の入力方式
      <select className={fieldClass} value={basis ? 'project' : 'coefficient'} onChange={e => {
        if (e.target.value === 'project') onChange({ ...value, basis: {
          ...EMPTY_PROJECT_BASIS, budgetTrillion: policy.annualCost / TRILLION,
        } });
        else { const direct = { ...current, basis: undefined }; onChange(direct); }
      }}>
        <option value="coefficient">1兆円当たりの原単位を入力</option>
        <option value="project">事業計画の人員・電力から換算</option>
      </select>
    </label>
    {basis ? <>
      <p className="text-sm">同じ事業・同じ価格基準の公費額と、その政策で純増する人員・電力を入力します。
        総事業費と補助金額を混ぜず、既存設備の需要を含めないでください。計画値の実現と比例拡大は仮定です。</p>
      <RangeField label={`${policy.name}・基準事業の公費額（年0価格）`} value={basis.budgetTrillion}
        min={.01} max={100} step={.01} unit="兆円" onChange={n => changeBasis('budgetTrillion', n)} />
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ['workerYears', '支出年の追加人員', 0, 1e7, 1, '人年'],
          ['sectorWorkerCapacity', `${SECTOR_LABELS[policy.sector]}の年間人員能力`, 1, 1e8, 1, '人年'],
          ['constructionPeakMw', '支出年の追加ピーク電力', 0, 1e5, 1, 'MW'],
          ['annualConstructionGwh', '支出年の年間電力量（燃料輸入の換算用）', 0, 1e6, 1, 'GWh/年'],
          ['operatingPeakMw', '稼働後の系統ピークへの純追加電力', 0, 1e5, 1, 'MW'],
          ['annualOperatingGwh', '稼働後の年間電力量（燃料輸入と、ピーク不明時の換算用）', 0, 1e6, 1, 'GWh/年'],
          ['annualLoadFactor', '年間負荷率（平均電力÷設備ピーク）', .01, 1, .01, '比率'],
          ['peakCoincidence', '系統ピークとの同時発生係数', 0, 1, .01, '比率'],
        ] as const).map(([key, label, min, max, step, unit]) => <NullableNumber key={key}
          label={`${policy.name}・${label}`} value={basis[key] ?? null} min={min} max={max} step={step} unit={unit}
          onChange={n => changeBasis(key, n)} />)}
      </div>
      <p className="text-sm">人員の稼働率増分＝追加人年÷当該産業の年間人員能力。設備の稼働率とは別の代理指標です。
        1GW＝1,000MW。年間電力からの系統ピーク寄与は、GWh÷8,760時間÷負荷率×同時発生係数。
        直接入力した稼働後ピークがある場合はそちらを使用し、年間電力から重ねて加算しません。
        年間電力量は火力の限界供給割合と燃料単価（共通の電力経路）で燃料輸入額へ換算します。</p>
      <output className="block rounded bg-mirai-surface-warm p-3 text-sm" data-testid={`load-conversion-${policy.id}`}>
        1兆円当たり：産業稼働率 {current.sectorUtilizationPerTrillion === null ? '未評価' : percent(current.sectorUtilizationPerTrillion)}、
        当年ピーク {current.peakGwPerTrillion === null ? '未評価' : `${current.peakGwPerTrillion.toFixed(3)}GW`}、
        稼働後ピーク {current.operatingPeakGwPerTrillion === null ? '未評価' : `${current.operatingPeakGwPerTrillion.toFixed(3)}GW`}、
        当年電力量 {current.annualGwhPerTrillion == null ? '未評価' : `${current.annualGwhPerTrillion.toFixed(1)}GWh`}、
        稼働後電力量 {current.operatingAnnualGwhPerTrillion == null ? '未評価' : `${current.operatingAnnualGwhPerTrillion.toFixed(1)}GWh`}。
      </output>
    </> : <div className="grid gap-4 sm:grid-cols-2">
      {([
        ['sectorUtilizationPerTrillion', '支出1兆円の産業稼働率増分', .1, .001, '比率'],
        ['peakGwPerTrillion', '支出1兆円の建設・当年ピーク負荷', 10, .1, 'GW'],
        ['operatingPeakGwPerTrillion', '投資1兆円の稼働後ピーク負荷', 10, .1, 'GW'],
        ['annualGwhPerTrillion', '支出1兆円の当年電力量（燃料輸入へ換算）', 1e5, 1, 'GWh'],
        ['operatingAnnualGwhPerTrillion', '投資1兆円の稼働後年間電力量（燃料輸入へ換算）', 1e5, 1, 'GWh'],
      ] as const).map(([key, label, max, step, unit]) => <NullableNumber key={key}
        label={`${policy.name}・${label}`} value={value[key] ?? null} max={max} step={step} unit={unit}
        onChange={n => onChange({ ...value, [key]: n })} />)}
    </div>}
    <div className="grid gap-4 sm:grid-cols-3">
      {([
        ['lag', '稼働までの年数', 0, 15, 1, '年'],
        ['lifetime', '稼働期間', 1, 60, 1, '年'],
        ['depreciation', '負荷の年間減耗率', 0, 1, .01, '比率'],
      ] as const).map(([key, label, min, max, step, unit]) => <RangeField key={key}
        label={`${policy.name}・${label}`} value={value[key]} min={min} max={max} step={step} unit={unit}
        onChange={n => onChange({ ...value, [key]: n })} />)}
    </div>
  </div>;
}

export function PolicyLoads({ policies, onChange }: {
  policies: Policy[]; onChange: (id: string, load: Policy['load']) => void;
}) {
  const active = policies.filter(x => x.annualCost > 0);
  return <section className="space-y-4 rounded-xl border border-mirai-border bg-card p-5" aria-label="政策別の負荷条件">
    <h2 className="text-lg font-bold">政策別の人員・電力負荷</h2>
    <p className="text-sm">空欄は未評価です。負荷がないと仮定する項目には0を入力します。
      人員と電力は別々に判定し、電力は当年・稼働後の両方が分かるまで未評価を残します。
      公表統計からの概算は政策ごとに上書きできます。手入力の空欄を概算で補完することはありません。
      年間電力量は火力の限界供給割合と燃料単価で燃料輸入費へ換算し、輸入・貿易収支・物価に入れます。電力量が空欄の政策は燃料輸入が未評価です。</p>
    {active.length === 0 && <p className="text-sm">政策額を入力すると、その政策の負荷を設定できます。</p>}
    {active.map(policy => {
      const coverage = loadCoverage(policy.load);
      return <details key={policy.id}>
        <summary className="cursor-pointer text-sm font-bold">{policy.name}：産業 {coverage.sector ? policy.load?.estimated ? '概算' : '設定あり' : '未評価'}／電力ピーク {coverage.energy ? policy.load?.estimated ? '概算' : '設定あり' : '未評価'}／燃料輸入 {coverage.fuel ? policy.load?.estimated ? '概算' : '設定あり' : '未評価'}</summary>
        {policy.load?.estimated && <p className="mt-2 text-sm">{RESOURCE_PROFILE_NOTES[policy.id]} 価格補正・電力単価などは「産業・電力制約を概算する」で調整できます。</p>}
        <label className="my-3 block text-sm">
          <input type="checkbox" checked={!!policy.load && !policy.load.estimated} onChange={e => onChange(policy.id, e.target.checked ? {
            sectorUtilizationPerTrillion: null, peakGwPerTrillion: null, operatingPeakGwPerTrillion: null,
            lag: 2, lifetime: 20, depreciation: .03,
          } : undefined)} /> {policy.name}の負荷条件を入力する
        </label>
        {policy.load && !policy.load.estimated && <LoadFields policy={policy} value={policy.load} onChange={load => onChange(policy.id, load)} />}
      </details>;
    })}
  </section>;
}
