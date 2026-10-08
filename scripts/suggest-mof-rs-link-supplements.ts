/**
 * 補完リンクの確認用に、自動では決まらなかった候補を出す。
 *   npx tsx scripts/generate-mof-rs-kou-moku-linkage.ts --sheet 2025 --budget-year 2024   # 未一致の全件を作る
 *   npx tsx scripts/suggest-mof-rs-link-supplements.ts
 * 補足情報（note）と金額・名前（amount+name）で決まるものは結びつけの生成処理が自動で結ぶ。ここに出るのは
 * レビューシート 2-2 の項・目が空欄で、事業ごとの合計額が10億円以上、同じ府省・会計に金額か名前の合う目があるもの。
 * 確認して正しいものを scripts/data/mof-rs-link-supplements.json の reviewed に足す（事業×予算種別ごとに目のキー）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MOFKouMokuItem } from '../types/mof-kou-moku';
import { amountHit, nameHit, sameScope } from './lib/link-supplements';

const BUDGET_YEARS = [2024, 2025, 2026];
const mofBudgetType = (rs: string) => {
  if (rs.includes('当初')) return '当初予算';
  const n = /第(\d)次補正/.exec(rs);
  return n ? `補正予算（第${n[1]}号）` : null;
};

for (const budgetYear of BUDGET_YEARS) {
  const file = path.resolve(`public/data/mof-rs-linkage-unmatched-${budgetYear}.json`);
  if (!fs.existsSync(file)) { console.warn(`skip ${budgetYear}: ${file} が無い`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 未一致の目を、補完の候補に使う形（MOFKouMokuItem 相当）に戻す
  const mof = (data.unmatchedMof as Record<string, string & number>[]).map(m => ({ ...m, key: m.kouMokuKey, specialAccount: m.accountType === 'special' ? m.organization : '' })) as unknown as MOFKouMokuItem[];
  for (const rs of data.unmatchedRs) {
    if (rs.reason !== 'rs-no-subject-code' || rs.rsAmount < 1e9) continue;
    const type = mofBudgetType(rs.rsBudgetType);
    if (!type) continue;
    const row = { projectName: rs.projectName, projectMinistry: rs.projectMinistry, accountCategory: rs.accountCategory, account: rs.account, subAccount: rs.subAccount, note: rs.note, amount: rs.rsAmount };
    const cands = sameScope(row, mof, type).filter(m => amountHit(rs.rsAmount, m) || nameHit(rs.projectName, m)).slice(0, 4);
    if (!cands.length) continue;
    console.log(`${budgetYear} ${rs.projectId} ${rs.projectName.slice(0, 40)} [${type} ${(rs.rsAmount / 1e8).toFixed(0)}億・${rs.rows}行] 補足:${(rs.note || '').slice(0, 30)}`);
    for (const c of cands) console.log(`    ${c.key} (${(c.amount / 1e8).toFixed(0)}億${amountHit(rs.rsAmount, c) ? '・額一致' : ''}${nameHit(rs.projectName, c) ? '・名一致' : ''})`);
  }
}
