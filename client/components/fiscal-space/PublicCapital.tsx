import type { FiscalCalculation } from '@/client/lib/fiscal-space-engine';
import { money, percent } from './format';

export function PublicCapital({ result }: { result: FiscalCalculation }) {
  const end = result.projection.steps[result.horizon - 1].publicCapital;
  if (!end) return null;
  return <details className="rounded-xl border border-mirai-border bg-card p-4" data-testid="public-capital-benefit">
    <summary className="cursor-pointer text-sm font-bold">公共投資の供用後便益：年{result.horizon}のGDPへ {money(end.realizedBenefit)}（内訳）</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>建設中の需要・終了後の反動と、完成した資本が残す生産便益を分けます。GDPへの便益は、稼働の立上がりと公表反応との重複控除を反映した追加分です。</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="公共投資の需要効果と供用後便益"><table className="w-full min-w-[660px] text-right text-sm">
        <caption className="text-left">基準年価格の兆円。資本残存額はストック、便益は各年のフローです。</caption>
        <thead><tr>{['年', '供用済み純追加資本', '潜在GDPの便益', 'GDPへ反映した便益', '建設需要・反動', 'この2経路の合計'].map(h => <th scope="col" key={h} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{result.projection.steps.slice(0, result.horizon).map(s => <tr key={s.state.year} className="border-t border-mirai-border">
          <th scope="row" className="p-2">{s.state.year}</th><td>{money(s.publicCapital!.stock)}</td><td>{money(s.publicCapital!.potentialBenefit)}</td><td>{money(s.publicCapital!.realizedBenefit)}</td><td>{money(s.publicCapital!.demandEffect)}</td><td>{money(s.publicCapital!.realizedBenefit + s.publicCapital!.demandEffect)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="text-xs">潜在GDPの便益を別に足すことはありません。複数政策の投入間の相互作用は公共資本を最後に取り除いた差で配分するため、各政策を単独実施した効果の合計とは一致しない場合があります。建設需要・反動は公表実験の近似で、施工能力を超えた投資の延期や終了後の反動の再校正は未実装です。</p>
      {result.publicCapitalSensitivity.length > 0 && <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="公共投資便益の重複控除感度"><table className="w-full text-right text-sm">
        <caption className="text-left">公表反応に含まれる便益をどれだけ差し引くか（感度）</caption>
        <thead><tr><th scope="col" className="py-2 text-left">重複控除率</th><th scope="col">供用後のGDP便益</th><th scope="col">全政策のGDP効果</th></tr></thead>
        <tbody>{result.publicCapitalSensitivity.map(row => <tr key={row.overlap} className="border-t border-mirai-border"><th scope="row" className="py-2 text-left">{percent(row.overlap, 0)}</th><td>{money(row.benefit)}</td><td>{money(row.gdpEffect)}</td></tr>)}</tbody>
      </table></div>}
      <p className="text-xs">信頼区間ではありません。設定は「政策別の供給力・長期条件」→「公共資本の蓄積」で変更できます。防災・時間短縮等の厚生便益と維持管理の追加費用は、このGDP便益に含めていません。</p>
    </div>
  </details>;
}
