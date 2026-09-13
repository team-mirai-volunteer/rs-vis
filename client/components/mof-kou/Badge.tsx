/**
 * 予算種別・会計区分の表示バッジ。
 *
 * 会計区分は `/sankey-svg` の会計区分バッジ（app/lib/account-badge.ts）と同じ見た目
 * （小さな色付きピル・白文字）をそのまま使う。予算種別はMOF予算書ページ固有のため
 * ここで色分けを定義するが、塗りつぶし＋白文字だと白文字とのコントラスト確保のため
 * 暗く濃い色に寄ってしまい、暫定/補正の橙系が決算の紫と並んだときに見分けにくかった。
 * そのため予算種別は「白背景＋色付き枠線＋黒系文字」に変更し、コントラスト制約なしで
 * Material Design 2 の色相をそのまま使えるようにしている。
 *
 * 配色はMaterial Design 2 のカラーシステム（m2.material.io/design/color）から選んだもの:
 *   当初=Green 500 #4caf50、暫定=Deep Orange 500 #ff5722、補正=Amber 700 #ffa000、
 *   決算=Purple 400 #ab47bc
 *
 * Badge（塗りつぶし・枠線なし）とOutlineBadge（白背景・border-2）は、同じ行内で高さが
 * 揃うように調整してある。OutlineBadgeはborder-2の分だけ上下パディングを持たせず
 * （py指定なし）、Badge側のpy-0.5との合計高さが一致するようにしている。どちらかの
 * パディング・ボーダーを変えるときはもう片方も見て高さのつり合いを確認すること
 * （py-0.4のようなTailwindのデフォルトspacingスケールに無い値は無音でCSSが生成されず、
 * 何も効かないので使わないこと）。
 */

import { getAccountBadgeStyle } from '@/app/lib/account-badge';
import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFKouMokuAccountType } from '@/types/mof-kou-moku';

export function Badge({ label, background }: { label: string; background: string }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-snug text-white"
      style={{ background }}
    >
      {label}
    </span>
  );
}

/** 白背景＋色付き枠線＋黒系文字のバッジ（予算種別用） */
export function OutlineBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded border-2 bg-white px-1.5 text-[10px] font-semibold leading-snug text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      style={{ borderColor: color }}
    >
      {label}
    </span>
  );
}

/** 会計区分バッジ（一般/特別/機関）。sankey-svg・subcontractsと同じ配色 */
export function AccountBadge({ accountType }: { accountType: MOFKouMokuAccountType }) {
  const style = getAccountBadgeStyle(accountType);
  if (!style) return null;
  return <Badge label={style.label} background={style.background} />;
}

/** 補正予算（第N号）→「補正N」の短縮ラベル。それ以外はそのまま */
function budgetTypeLabel(budgetType: MOFBudgetType): string {
  const revised = /^補正予算（第(\d+)号）$/.exec(budgetType);
  return revised ? `補正${revised[1]}` : budgetType.replace(/予算$/, '');
}

const BUDGET_TYPE_COLOR: Record<string, string> = {
  当初: '#4caf50',
  暫定: '#FF5722',
  決算: '#AB47BC',
};
const REVISED_COLOR = '#ffa000';

/** 予算種別バッジ（当初/暫定/補正N/決算） */
export function BudgetTypeBadge({ budgetType }: { budgetType: MOFBudgetType }) {
  const label = budgetTypeLabel(budgetType);
  const color = BUDGET_TYPE_COLOR[label] ?? (label.startsWith('補正') ? REVISED_COLOR : BUDGET_TYPE_COLOR.当初);
  return <OutlineBadge label={label} color={color} />;
}
