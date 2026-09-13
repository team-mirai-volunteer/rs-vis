#!/usr/bin/env npx tsx
/**
 * MOF 予算全体ビューの集計データ検証スクリプト。
 *
 * `public/data/mof-budget-overview-{YEAR}.json` の集計値を、同じ帳票の配布 CSV と
 * 1円単位で突き合わせる。集計は静かに壊れる（列の取り違えで0になる、条件の書き間違いで
 * 一部を落とす）ため、生成のたびにこれを通すこと。
 *
 * 使用法:
 *   tsx scripts/validate-mof-budget-overview-data.ts [FISCAL_YEAR...]
 *   デフォルト: public/data にある mof-budget-overview-*.json の全年度
 *
 * 突合の考え方は docs/mof-budget-data-guide.md 6節。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { MOFBudgetOverview } from '@/types/mof-budget-overview';
import { amountColumn, readBudgetTables, yen, type CsvRow } from '@/scripts/mof-budget-csv';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

/**
 * 生成物を読む。
 *
 * この生成物は `.gz` だけを Git 管理し、`decompress-data.sh` は展開しない
 * （サーバ側ローダが `.gz` をその場で展開して読むため）。検証も同じ前提に合わせ、
 * 生 JSON が無ければ `.gz` から読む。展開の有無で検証件数が変わるのを防ぐ。
 */
function readOverview(year: number): MOFBudgetOverview | null {
  const raw = path.join(DATA_DIR, `mof-budget-overview-${year}.json`);
  if (fs.existsSync(raw)) {
    return JSON.parse(fs.readFileSync(raw, 'utf-8')) as MOFBudgetOverview;
  }
  if (fs.existsSync(`${raw}.gz`)) {
    return JSON.parse(
      zlib.gunzipSync(fs.readFileSync(`${raw}.gz`)).toString('utf-8')
    ) as MOFBudgetOverview;
  }
  return null;
}

const TRANSFER_PURPOSE_CODE = '6';

function sum(rows: CsvRow[], column: string): number {
  return rows.reduce((acc, row) => acc + yen(row, column), 0);
}

function isTransferIn(row: CsvRow): boolean {
  return row['款名'] === '他会計より受入' || (row['目名'] ?? '').includes('一般会計より受入');
}

interface Check {
  label: string;
  actual: number;
  expected: number;
}

function validateYear(year: number): { ok: boolean; checked: number } {
  const data = readOverview(year);
  if (!data) {
    console.error(`  ${year}年度の生成物が見つかりません`);
    return { ok: false, checked: 0 };
  }
  console.log(`\n=== ${data.metadata.eraLabel}（${year}）${data.metadata.budgetType} ===`);

  const general = readBudgetTables(year, '11001');
  const special = readBudgetTables(year, '12001');
  const agency = readBudgetTables(year, '13001');
  const gRev = amountColumn(general.revenue);
  const gExp = amountColumn(general.expenditure);
  const sRev = amountColumn(special.revenue);
  const sExp = amountColumn(special.expenditure);
  const aRev = amountColumn(agency.revenue);
  const aExp = amountColumn(agency.expenditure);

  const transfersOf = (rows: CsvRow[], column: string) =>
    sum(
      rows.filter(r => r['使途別分類コード'] === TRANSFER_PURPOSE_CODE),
      column
    );

  const checks: Check[] = [
    {
      label: '一般会計 歳入合計',
      actual: data.generalAccount.revenue.total,
      expected: sum(general.revenue, gRev),
    },
    {
      label: '一般会計 歳出合計',
      actual: data.generalAccount.expenditure.total,
      expected: sum(general.expenditure, gExp),
    },
    {
      label: '一般会計 他会計へ繰入',
      actual: data.generalAccount.expenditure.transferOut,
      expected: transfersOf(general.expenditure, gExp),
    },
    {
      label: '特別会計 歳入合計',
      actual: data.specialAccounts.revenue.total,
      expected: sum(special.revenue, sRev),
    },
    {
      label: '特別会計 歳出合計',
      actual: data.specialAccounts.expenditure.total,
      expected: sum(special.expenditure, sExp),
    },
    {
      label: '特別会計 他会計へ繰入',
      actual: data.specialAccounts.expenditure.transferOut,
      expected: transfersOf(special.expenditure, sExp),
    },
    {
      label: '特別会計 受入（款・目の和集合）',
      actual: data.transfers.receivedBySpecial,
      expected: sum(special.revenue.filter(isTransferIn), sRev),
    },
    {
      label: '特別会計 勘定間の受入',
      actual: data.transfers.receivedBetweenSubAccounts,
      expected: sum(
        special.revenue.filter(r => r['款名'] === '他勘定より受入'),
        sRev
      ),
    },
    {
      label: '政府関係機関 収入合計',
      actual: data.agencies.revenue.total,
      expected: sum(agency.revenue, aRev),
    },
    {
      label: '政府関係機関 支出合計',
      actual: data.agencies.expenditure.total,
      expected: sum(agency.expenditure, aExp),
    },
  ];

  let ok = true;
  for (const check of checks) {
    const match = check.actual === check.expected;
    if (!match) ok = false;
    console.log(
      `  ${match ? 'OK ' : 'NG '} ${check.label.padEnd(28)} ` +
        `JSON ${check.actual.toLocaleString().padStart(22)} / CSV ${check.expected.toLocaleString().padStart(22)}`
    );
  }

  // 構造的な整合。実測で成立が確認できているもの。
  // 一次純計は生成物どうしの引き算なので、控除の元になる値は上の CSV 突合で押さえる
  // （そうしないと誤った款名フィルタが素通りして総額がずれる）
  const grossExpected =
    data.generalAccount.expenditure.total +
    data.specialAccounts.expenditure.total +
    data.agencies.expenditure.total;
  const netExpected =
    grossExpected -
    data.totals.deductions.receivedBySpecial -
    data.totals.deductions.receivedBetweenSubAccounts;
  const structural: Check[] = [
    { label: '単純合計', actual: data.totals.gross, expected: grossExpected },
    { label: '一次純計', actual: data.totals.net, expected: netExpected },
    {
      label: '会計別の受入合計 = 受入総額',
      actual: data.specialAccounts.accounts.reduce((s, a) => s + a.transferIn, 0),
      expected: data.transfers.receivedBySpecial,
    },
    {
      label: '会計別の歳出合計 = 特会歳出',
      actual: data.specialAccounts.accounts.reduce((s, a) => s + a.expenditure, 0),
      expected: data.specialAccounts.expenditure.total,
    },
  ];
  for (const check of structural) {
    const match = check.actual === check.expected;
    if (!match) ok = false;
    console.log(
      `  ${match ? 'OK ' : 'NG '} ${check.label.padEnd(28)} ` +
        `${check.actual.toLocaleString().padStart(22)} / ${check.expected.toLocaleString().padStart(22)}`
    );
  }

  return { ok, checked: checks.length + structural.length };
}

function main(): void {
  const years =
    process.argv.length > 2
      ? process.argv.slice(2).map(v => parseInt(v, 10))
      : [
          ...new Set(
            fs
              .readdirSync(DATA_DIR)
              .map(f => f.match(/^mof-budget-overview-(\d{4})\.json(\.gz)?$/)?.[1])
              .filter((y): y is string => Boolean(y))
              .map(Number)
          ),
        ].sort((a, b) => a - b);

  if (years.length === 0) {
    console.error('検証対象がありません。npm run generate-mof-data を実行してください。');
    process.exit(1);
  }

  let ok = true;
  let checked = 0;
  for (const year of years) {
    const result = validateYear(year);
    if (!result.ok) ok = false;
    checked += result.checked;
  }

  if (ok) {
    console.log(`\n✅ 全一致（${checked} 項目を検証）`);
  } else {
    console.error(`\n❌ 不一致があります（${checked} 項目を検証）`);
    process.exit(1);
  }
}

main();
