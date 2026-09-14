import type { LifecycleYear, TaxState } from '@/types/tax-burden';
import { PHASE_LABEL } from './LifecycleChart';
import { yen } from './BurdenBreakdown';

const AGES = [30, 40, 50, 60, 64, 65, 70, 75, 80];

/**
 * The same nine ages in two tables: yen in one, share of the working-age income in the other. Money and rates used to
 * share a row, which made the one percentage column read as if it belonged to the yen next to it.
 * Both tables carry the same items, so the two can be read side by side, and the rate columns add up to the net rate:
 * tax + contributions − benefits − pension received.
 */
export function LifecycleTable({ years, state, selectedAge }: { years: LifecycleYear[]; state: TaxState; selectedAge: number }) {
  const rows = AGES.map(a => years.find(y => y.ageAt === a)!).filter(Boolean);
  const consumption = (y: LifecycleYear) => state.includeConsumption ? y.consumptionTax : 0;
  const tax = (y: LifecycleYear) => y.incomeTax + y.residentTax + consumption(y) + y.corporateTax;
  const premiums = (y: LifecycleYear) => y.pension + y.health + y.care + y.employment;
  const net = (y: LifecycleYear) => y.pensionAdjustedBurden - (state.includeConsumption ? 0 : y.consumptionTax);
  const share = (y: LifecycleYear, amount: number) => y.careerIncome > 0 ? `${(amount / y.careerIncome * 100).toFixed(1)}%` : '未定義';
  const head = 'whitespace-nowrap py-1 text-right font-normal';
  const rowHead = (y: LifecycleYear) => <th scope="row" className="whitespace-nowrap py-1 text-left font-normal">{y.ageAt}歳（{PHASE_LABEL[y.phase]}）</th>;
  const rowClass = (y: LifecycleYear) => `border-t border-mirai-border/30 ${y.ageAt === selectedAge ? 'font-bold' : ''}`;
  return <div className="mt-4 grid gap-5">
    <div>
      <h3 className="mb-1 text-xs font-bold">年額（円）</h3>
      <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums" aria-label="年齢別の金額（年額）">
        <thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left font-normal">年齢</th>
          <th scope="col" className={head}>総収入</th><th scope="col" className={head}>うち年金</th><th scope="col" className={head}>税</th>
          <th scope="col" className={head}>保険料</th><th scope="col" className={head}>給付</th><th scope="col" className={head}>可処分所得</th></tr></thead>
        <tbody>{rows.map(y => <tr key={y.ageAt} className={rowClass(y)}>{rowHead(y)}
          <td className="whitespace-nowrap text-right">{yen(y.income)}</td><td className="whitespace-nowrap text-right">{yen(y.pensionIncome)}</td><td className="whitespace-nowrap text-right">{yen(tax(y))}</td>
          <td className="whitespace-nowrap text-right">{yen(premiums(y))}</td><td className="whitespace-nowrap text-right">{yen(y.benefits)}</td>
          <td className="whitespace-nowrap text-right">{yen(y.disposable - consumption(y))}</td></tr>)}</tbody>
      </table></div>
    </div>
    <div>
      <h3 className="mb-1 text-xs font-bold">現役期年収に対する割合（%）</h3>
      <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums" aria-label="年齢別の割合（現役期年収比）">
        <thead><tr className="text-mirai-text-secondary"><th scope="col" className="py-1 text-left font-normal">年齢</th>
          <th scope="col" className={head}>税</th><th scope="col" className={head}>保険料</th><th scope="col" className={head}>給付</th>
          <th scope="col" className={head}>年金の受給</th><th scope="col" className={head}>純負担率</th></tr></thead>
        <tbody>{rows.map(y => <tr key={y.ageAt} className={rowClass(y)}>{rowHead(y)}
          <td className="whitespace-nowrap text-right">{share(y, tax(y))}</td><td className="whitespace-nowrap text-right">{share(y, premiums(y))}</td>
          <td className="whitespace-nowrap text-right">{share(y, -y.benefits)}</td><td className="whitespace-nowrap text-right">{share(y, -y.pensionIncome)}</td>
          <td className="whitespace-nowrap text-right">{share(y, net(y))}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-2 text-xs leading-relaxed text-mirai-text-subtle">分母はどの年齢も現役期の世帯年収。給付と年金の受給は負の値で、税＋保険料＋給付＋年金の受給＝純負担率になります。税には{state.includeConsumption ? '消費税推計と' : ''}法人税の転嫁（仮定）を含みます。</p>
    </div>
  </div>;
}
