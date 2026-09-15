import type { FiscalRiskAudit } from '@/app/lib/fiscal-space/risk-audit';
import { POLICIES } from '@/app/lib/fiscal-space/assumptions';
import { money, percent } from './format';

function outcome(row: FiscalRiskAudit['baselineSensitivity'][number]) {
  if (row.status === 'unevaluated') return '必要な負荷データが足りず計算できません';
  if (row.status === 'empty-mix') return '比較する政策の配分を入力してください';
  if (row.status === 'baseline-violated') return `追加額が0円でも、将来の${row.binding.join('・') || '指標'}が設定上限を超えます`;
  if (row.status === 'revenue-cap') return `${POLICIES.find(p => p.id === row.limitingPolicy)?.name ?? '減税'}が対象税収の全額に達します`;
  if (row.status === 'search-cap') return '計算範囲の上端まで増やせました。上限はまだ分かりません';
  return row.binding.map(label => label === '電力供給能力' ? '電力需要が設定した供給上限に達します'
    : label === '物価' ? '物価上昇率が設定上限に達します'
      : `${label}が設定上限に達します`).join('。');
}

export function BaselineSensitivity({ rows }: { rows: FiscalRiskAudit['baselineSensitivity'] }) {
  return <div className="space-y-3" data-testid="baseline-inflation-sensitivity">
    <p className="text-sm">政策を追加しない場合の物価上昇率を変えると、同じ政策配分で増やせる年額がどう変わるかを比較します。</p>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="物価上昇の想定別の参考上限"><table className="w-full min-w-[480px] text-right text-sm">
      <caption className="mb-2 text-left font-bold">今後の物価上昇の想定と、追加額の参考上限</caption>
      <thead><tr><th scope="col" className="p-2 text-left">想定する物価上昇率</th><th scope="col" className="p-2">追加額の参考上限／年</th><th scope="col" className="p-2 text-left">この額で増額が止まる理由</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.inflation} className="border-t border-mirai-border"><th scope="row" className="p-2 text-left">{percent(r.inflation, 1)}{r.current && '（現在の設定）'}</th><td className="p-2 whitespace-nowrap">{r.status === 'unevaluated' ? '算出不可' : r.status === 'empty-mix' ? '—' : money(r.amount, 1)}</td><td className="p-2 text-left">{outcome(r)}</td></tr>)}</tbody>
    </table></div>
    <p className="text-xs">現在の観測値（年0）、許容する物価上昇率、政策の配分、その他の条件は固定しています。想定する物価上昇率に、GDPギャップなどの影響を加えて将来の物価を計算します。0円の行は、将来の想定と許容上限が両立しない条件です。</p>
    <p className="text-xs">年額は任意控除前の合計で、入力額への上乗せ額ではありません。0.1兆円単位の表示は丸めた計算値です。この比較は予測の確かさや信頼区間を示しません。</p>
  </div>;
}
