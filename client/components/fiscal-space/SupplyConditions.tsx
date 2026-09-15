import { SUPPLY_CASES, type SupplyCase } from '@/app/lib/fiscal-space/supply';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { fieldClass } from './format';

export function SupplyConditions({ value, onChange }: { value: Record<string, SupplyCase>; onChange: (v: Record<string, SupplyCase>) => void }) {
  return <Card><CardHeader><h2 className="text-lg font-bold">政策別の供給力・長期条件</h2>
    <p className="text-xs leading-relaxed">研究・公共資本・教育は支出後も残る効果、保育は利用中の就労効果を計算します。純追加性は、既存の投資の置換や実施失敗を除いて効果を生む割合。初期50%は比較条件で、日本の実証値ではありません。</p>
    <p className="text-xs leading-relaxed">以下の式は投入への参照換算です。実際の供給力は設備・有効労働・エネルギー・TFPに変換し、選択した生産関数で再計算します。レオンチェフでは不足していない投入の増加だけでは潜在GDPが増えない場合があります。</p>
  </CardHeader><CardContent className="space-y-2 text-xs">{Object.entries(SUPPLY_CASES).map(([id, ref]) => <details key={id} className="rounded-lg border border-mirai-border p-3">
    <summary className="cursor-pointer font-bold">{ref.label}：純追加性{Math.round(value[id].additionality * 100)}%・{value[id].lag}年後から</summary>
    <p className="mt-3 leading-relaxed">{ref.evidence} <a href={ref.source} className="underline" target="_blank" rel="noreferrer">出典</a></p>
    <p className="mt-2 leading-relaxed">参照換算：{ref.formula}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">{([
      ['additionality', '純追加性', 100, 0, 100, 5], ['lag', '効果までの年数', 1, 0, 30, 1],
      ['depreciation', '年間減耗率', 100, 0, 100, 1], ['lifetime', '効果期間', 1, 1, 60, 1],
      ['yield', '効果係数', 1, 0, 1, .01], ['unitCost', '単位費用・基準資本比', 1, .01, 1e8, 1],
      ['employment', '就労・常勤換算', 100, 0, 100, 5],
    ] as const).filter(([key]) => !(['capital', 'research', 'grid'].includes(value[id].kind) && key === 'employment')).map(([key, label, scale, min, max, step]) =>
      <label key={key}>{label}{scale === 100 ? '（%）' : key === 'lag' || key === 'lifetime' ? '（年）' : key === 'unitCost' && ['education', 'childcare'].includes(value[id].kind) ? '（円/人年）' : ''}
        <input type="number" aria-label={`${ref.label}・${label}`} className={`${fieldClass} mt-1`} value={Number((value[id][key] * scale).toFixed(6))} min={min} max={max} step={step} onChange={e => {
          if (e.target.value === '') return;
          const raw = Number(e.target.value);
          if (!Number.isFinite(raw)) return;
          const n = Math.min(max, Math.max(min, raw));
          onChange({ ...value, [id]: { ...value[id], [key]: (key === 'lag' || key === 'lifetime' ? Math.round(n) : n) / scale } });
        }} />
      </label>)}</div>
    {value[id].kind === 'grid' && <div className="mt-3 grid gap-3 sm:grid-cols-3">{([
      ['maintenanceRate', '年間保守費率', .01], ['maintenanceImportShare', '保守費の輸入割合', .2], ['generationOverlapShare', '追加再エネと重複し得る便益', 1],
    ] as const).map(([key, label, fallback]) => <label key={key}>{label}（%）<input type="number" aria-label={`送電網・${label}`} className={`${fieldClass} mt-1`} min={0} max={100} step={1} value={Number(((value[id][key] ?? fallback) * 100).toFixed(4))} onChange={e => {
      if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange({ ...value, [id]: { ...value[id], [key]: Math.min(100, Math.max(0, e.target.valueAsNumber)) / 100 } });
    }} /></label>)}</div>}
  </details>)}
    <p className="leading-relaxed">主表は1・3・5年の比較、長期投資は稼働開始時の年間供給効果を別に示します。研究・公共資本・教育の新たな供給能力は短期モデルとの重複を避け、期間内のGDPへそのまま加算しません。発電・送電網の稼働後の貿易・資源節約は、保守費や便益の重複を控除して計上します。年間効果は事業条件に基づき、将来のGDP予測ではありません。医療・防衛・給付・消費税の供給効果は、政策設計を特定できないため数値を表示しません。</p>
  </CardContent></Card>;
}
