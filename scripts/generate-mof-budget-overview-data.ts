#!/usr/bin/env npx tsx
/**
 * MOF 予算全体ビューの集計データ生成スクリプト。
 *
 * 予算書 ZIP 同梱の科目別内訳 CSV から、会計区分・款別・繰入・純計を集計する。
 * 出力は**集計値だけ**でサンキーの形は持たない（可視化を変えても再生成が要らないように）。
 *
 * 使用法:
 *   tsx scripts/generate-mof-budget-overview-data.ts [FISCAL_YEAR...]
 *   デフォルト: 2017〜2026（10年度分）
 *
 * 出力: public/data/mof-budget-overview-{FISCAL_YEAR}.json
 *
 * 対象は**当初予算のみ**（一般会計 11001 / 特別会計 12001 / 政府関係機関 13001）。
 * 捕捉ロジックの根拠は docs/mof-budget-data-guide.md 6節。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  MOFAmountGroup,
  MOFBudgetOverview,
  MOFSpecialAccountSummary,
  MOFTransferReconciliation,
} from '@/types/mof-budget-overview';
import {
  amountColumn,
  groupByName,
  readBudgetTables,
  toEraLabel,
  yen,
  type CsvRow,
} from '@/scripts/mof-budget-csv';

const DEFAULT_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** 他会計へ繰入を表す使途別分類コード（docs/mof-budget-data-guide.md 4-6節） */
const TRANSFER_PURPOSE_CODE = '6';

/**
 * 使途別分類コード表（docs/mof-budget-data-guide.md 4-6節）。
 *
 * 表に無いコードは `その他` に混ぜず `UNKNOWN_PURPOSE` に分ける。コード9が
 * 既に `その他` なので、混ぜると新設・空欄のコードが黙って埋もれ、
 * 内訳が静かに壊れる（検証は byPurpose を見ない）。
 */
const PURPOSE_NAMES: Record<string, string> = {
  '1': '人件費',
  '2': '旅費',
  '3': '物件費',
  '4': '施設費',
  '5': '補助費・委託費',
  '6': '他会計へ繰入',
  '9': 'その他',
};

/** 表に無い使途別分類コードの表示名。コード9の「その他」とは別枠にする */
const UNKNOWN_PURPOSE = '分類不明';

/**
 * 特別会計が一般会計へ回した額を、一般会計歳入側で拾うための目名の条件。
 *
 * 逆方向の繰入は**歳出予算に載らない**（原資が剰余金のため）。歳出側を探しても
 * 令和8年度で7億円しか出ず、本体は一般会計歳入の款 `諸収入` にある。
 */
function isFromSpecialAccount(itemName: string): boolean {
  return (
    itemName.endsWith('特別会計受入金') ||
    itemName.endsWith('特別会計整理収入') ||
    itemName.endsWith('特別会計等負担金')
  );
}

/**
 * 特別会計が他会計から受け入れた行かどうか。
 *
 * **款名だけでは足りない。**年金特別会計は「一般会計より受入」が款 `保険収入` の下に
 * 置かれており、款で絞ると毎年10〜13兆円を取りこぼす（docs/mof-budget-data-guide.md 6-2節）。
 */
function isTransferIn(row: CsvRow): boolean {
  return row['款名'] === '他会計より受入' || (row['目名'] ?? '').includes('一般会計より受入');
}

/** 他会計・他勘定から回ってきた行。自前財源を出すときに除く */
function isInternalReceipt(row: CsvRow): boolean {
  return isTransferIn(row) || row['款名'] === '他勘定より受入';
}

/**
 * 繰入の目名から宛先の特別会計を特定する。会計名の一覧は CSV から作るので固定表を持たない。
 *
 * 候補は**長い名前から**照合する。ある会計名が別の会計名の部分文字列だった場合、
 * CSV の行順に依存して短い方が先に当たると宛先を取り違えるため。
 */
function resolveDestination(itemName: string, sortedAccountNames: string[]): string | null {
  return sortedAccountNames.find(name => itemName.includes(`${name}特別会計`)) ?? null;
}

function sum(rows: CsvRow[], column: string): number {
  return rows.reduce((acc, row) => acc + yen(row, column), 0);
}

function generateYear(fiscalYear: number): void {
  const eraLabel = toEraLabel(fiscalYear);
  console.log(`\n=== ${eraLabel}（${fiscalYear}） ===`);

  const general = readBudgetTables(fiscalYear, '11001');
  const special = readBudgetTables(fiscalYear, '12001');
  const agency = readBudgetTables(fiscalYear, '13001');

  const gRev = amountColumn(general.revenue);
  const gExp = amountColumn(general.expenditure);
  const sRev = amountColumn(special.revenue);
  const sExp = amountColumn(special.expenditure);
  const aRev = amountColumn(agency.revenue);
  const aExp = amountColumn(agency.expenditure);

  // 特別会計の一覧は歳出表から作る（年度により増減するため固定表を持たない）
  const accountNames = [...new Set(special.expenditure.map(r => r['特別会計']).filter(Boolean))];
  // 宛先の照合は長い名前を優先する（部分一致の取り違えを防ぐ）
  const accountNamesByLength = [...accountNames].sort((a, b) => b.length - a.length);

  // --- 一般会計 ---
  const generalTransfers = general.expenditure.filter(
    r => r['使途別分類コード'] === TRANSFER_PURPOSE_CODE
  );
  const generalTransferOut = sum(generalTransfers, gExp);
  const generalExpTotal = sum(general.expenditure, gExp);
  const fromSpecialRows = general.revenue.filter(r => isFromSpecialAccount(r['目名'] ?? ''));

  // --- 特別会計 ---
  const specialTransfers = special.expenditure.filter(
    r => r['使途別分類コード'] === TRANSFER_PURPOSE_CODE
  );
  const specialTransferOut = sum(specialTransfers, sExp);
  const specialExpTotal = sum(special.expenditure, sExp);
  const transferInRows = special.revenue.filter(isTransferIn);
  const receivedBySpecial = sum(transferInRows, sRev);
  const receivedBetweenSubAccounts = sum(
    special.revenue.filter(r => r['款名'] === '他勘定より受入'),
    sRev
  );
  // 自前財源。年金特会は「一般会計より受入」が款「保険収入」の下にあるため、
  // 款ではなく行単位で除かないと受入が自前財源に混ざる
  const specialOwnRows = special.revenue.filter(r => !isInternalReceipt(r));

  // 会計別の要約
  const accounts: MOFSpecialAccountSummary[] = accountNames
    .map(name => {
      const revRows = special.revenue.filter(r => r['特別会計'] === name);
      const expRows = special.expenditure.filter(r => r['特別会計'] === name);
      const revenue = sum(revRows, sRev);
      const transferIn = sum(revRows.filter(isTransferIn), sRev);
      return {
        name,
        subAccountCount: new Set(expRows.map(r => r['勘定']).filter(Boolean)).size,
        revenue,
        expenditure: sum(expRows, sExp),
        transferIn,
        transferOut: sum(
          expRows.filter(r => r['使途別分類コード'] === TRANSFER_PURPOSE_CODE),
          sExp
        ),
        ownRevenueRate: revenue > 0 ? (revenue - transferIn) / revenue : 0,
      };
    })
    .sort((a, b) => b.expenditure - a.expenditure);

  // 宛先別の突合（送り手＝一般会計の繰入 / 受け手＝特会の受入）
  const fromGeneralByAccount = new Map<string, number>();
  for (const row of generalTransfers) {
    const dest = resolveDestination(row['目名'] ?? '', accountNamesByLength);
    if (dest) fromGeneralByAccount.set(dest, (fromGeneralByAccount.get(dest) ?? 0) + yen(row, gExp));
  }
  const reconciliation: MOFTransferReconciliation[] = accounts
    .map(a => ({
      account: a.name,
      fromGeneral: fromGeneralByAccount.get(a.name) ?? 0,
      received: a.transferIn,
    }))
    .filter(r => r.fromGeneral > 0 || r.received > 0)
    .sort((a, b) => b.received - a.received);

  const agencyExpTotal = sum(agency.expenditure, aExp);
  const gross = generalExpTotal + specialExpTotal + agencyExpTotal;
  const specialToGeneral = sum(fromSpecialRows, gRev);

  const byPurpose = (rows: CsvRow[], column: string): MOFAmountGroup[] =>
    groupByName(rows, column, r => PURPOSE_NAMES[r['使途別分類コード']] ?? UNKNOWN_PURPOSE);

  const data: MOFBudgetOverview = {
    metadata: {
      fiscalYear,
      eraLabel,
      budgetType: '当初予算',
      generatedAt: new Date().toISOString(),
      unit: 'yen',
      notes: [
        '全金額は円単位です（予算書の印字は千円単位。生成時に1000倍しています）',
        '対象は当初予算のみです（補正予算・決算は含みません）',
        '一般会計・特別会計・政府関係機関の歳出を単純合算すると会計間の繰入が二重計上されます',
        '他会計へ繰入は使途別分類コード6で捕捉しています',
        '特別会計の受入は款「他会計より受入」と目「一般会計より受入」の和集合です（款だけでは年金特会を取りこぼします）',
        '特別会計から一般会計への繰入は歳出予算に載らず、一般会計歳入の「◯◯特別会計受入金」にのみ現れます',
      ],
    },
    generalAccount: {
      revenue: {
        total: sum(general.revenue, gRev),
        byCategory: groupByName(general.revenue, gRev, r => r['款名']),
        taxes: groupByName(
          general.revenue.filter(r => r['款名'] === '租税'),
          gRev,
          r => r['目名']
        ),
        fromSpecialAccounts: groupByName(fromSpecialRows, gRev, r => r['目名']),
      },
      expenditure: {
        total: generalExpTotal,
        transferOut: generalTransferOut,
        net: generalExpTotal - generalTransferOut,
        transfersByDestination: groupByName(generalTransfers, gExp, r => r['目名']),
        byPurpose: byPurpose(general.expenditure, gExp),
      },
    },
    specialAccounts: {
      revenue: {
        total: sum(special.revenue, sRev),
        byCategory: groupByName(special.revenue, sRev, r => r['款名']),
        own: {
          total: sum(specialOwnRows, sRev),
          byCategory: groupByName(specialOwnRows, sRev, r => r['款名']),
        },
      },
      expenditure: {
        total: specialExpTotal,
        transferOut: specialTransferOut,
        net: specialExpTotal - specialTransferOut,
        transfersByDestination: groupByName(specialTransfers, sExp, r => r['目名']),
        byPurpose: byPurpose(special.expenditure, sExp),
      },
      accounts,
    },
    agencies: {
      revenue: {
        total: sum(agency.revenue, aRev),
        byCategory: groupByName(agency.revenue, aRev, r => r['款名']),
      },
      expenditure: {
        total: agencyExpTotal,
        byAgency: groupByName(agency.expenditure, aExp, r => r['政府関係機関']),
      },
    },
    transfers: {
      generalToOther: generalTransferOut,
      specialToOther: specialTransferOut,
      receivedBySpecial,
      receivedBetweenSubAccounts,
      specialToGeneral,
      specialToGeneralDetail: groupByName(fromSpecialRows, gRev, r => r['目名']),
      reconciliation,
    },
    totals: {
      gross,
      net: gross - receivedBySpecial - receivedBetweenSubAccounts,
      deductions: { receivedBySpecial, receivedBetweenSubAccounts },
    },
  };

  const outputFile = path.join(
    process.cwd(),
    'public',
    'data',
    `mof-budget-overview-${fiscalYear}.json`
  );
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

  const t = (v: number) => (v / 1e12).toFixed(2);
  console.log(`  一般会計 歳出 ${t(generalExpTotal)}兆（うち繰入 ${t(generalTransferOut)}兆）`);
  console.log(`  特別会計 歳出 ${t(specialExpTotal)}兆（うち繰入 ${t(specialTransferOut)}兆）`);
  console.log(`  政府関係機関 支出 ${t(agencyExpTotal)}兆 / 特会 ${accounts.length}会計`);
  console.log(`  単純合計 ${t(gross)}兆 → 一次純計 ${t(data.totals.net)}兆`);
  console.log(`  出力: ${path.basename(outputFile)}`);
}

function main(): void {
  const years =
    process.argv.length > 2
      ? process.argv.slice(2).map(v => parseInt(v, 10))
      : DEFAULT_YEARS;
  if (years.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`=== MOF 予算全体ビュー生成（対象: ${years.join(', ')}） ===`);
  for (const year of years) generateYear(year);
  console.log(`\n完了: ${years.length} 年度分を生成しました。`);
}

main();
