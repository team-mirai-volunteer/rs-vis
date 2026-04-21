#!/usr/bin/env npx ts-node
/**
 * MOF財源データパーサー
 * 財務省の予算・決算CSVを読み込み、財源情報を抽出する
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as iconv from 'iconv-lite';
import type {
  MOFFundingData,
  FundingSources,
  SpecialAccountFunding,
  MinistryFunding,
} from '@/types/structured';

// ES Module用のディレクトリ取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MOFデータディレクトリ
const MOF_DATA_DIR = path.join(__dirname, '../data/download/mof_2024');
const OUTPUT_DIR = path.join(__dirname, '../public/data');

// 予算ファイル
const GENERAL_ACCOUNT_REVENUE_FILE = 'DL202411001a.csv'; // 一般会計歳入
const SPECIAL_ACCOUNT_REVENUE_FILE = 'DL202412001a.csv'; // 特別会計歳入

// 決算ファイル
const GENERAL_ACCOUNT_SETTLEMENT_FILE = 'DL202477001a.csv'; // 一般会計決算歳入
const SPECIAL_ACCOUNT_SETTLEMENT_FILE = 'DL202478001a.csv'; // 特別会計決算歳入

/**
 * CSVファイルを読み込む（UTF-8またはShift-JISに対応）
 */
function readCSV(filePath: string): Record<string, string>[] {
  const buffer = fs.readFileSync(filePath);

  // UTF-8で読み込みを試行、失敗したらShift-JISで読み込み
  let content: string;
  try {
    content = buffer.toString('utf-8');
    // BOMの除去
    if (content.charCodeAt(0) === 0xfeff) {
      content = content.slice(1);
    }
    // UTF-8として正しく読めたか確認（日本語が含まれているか）
    if (!content.includes('款') && !content.includes('項')) {
      throw new Error('Not valid UTF-8 for Japanese');
    }
  } catch {
    // Shift-JISで読み込み
    content = iconv.decode(buffer, 'Shift_JIS');
  }

  return parseCSVContent(content);
}

/**
 * CSV文字列をパース
 */
function parseCSVContent(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseLine(line);
    if (values.length !== headers.length) {
      continue; // スキップ
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

/**
 * CSV行をパース
 */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentField += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }

  fields.push(currentField.trim());
  return fields;
}

/**
 * 金額文字列を数値に変換（千円単位 → 円単位）
 */
function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/,/g, '').replace(/△/g, '-').trim();
  const value = Number(cleaned);
  // 千円単位を円単位に変換
  return isNaN(value) ? 0 : value * 1000;
}

/**
 * 一般会計歳入データを解析
 */
function parseGeneralAccountRevenue(
  rows: Record<string, string>[],
  amountColumn: string
): {
  fundingSources: FundingSources;
  byMinistry: Map<string, FundingSources>;
} {
  const fundingSources: FundingSources = {
    taxRevenue: 0,
    publicBonds: 0,
    insurancePremiums: 0,
    transferFromGeneral: 0,
    other: 0,
    total: 0,
  };

  const byMinistry = new Map<string, FundingSources>();

  for (const row of rows) {
    const kaName = row['款名'] || ''; // 款名（財源カテゴリ）
    const amount = parseAmount(row[amountColumn] || '0');
    const ministry = row['主管'] || '共通';

    // 財源カテゴリ別に集計
    if (kaName === '租税') {
      fundingSources.taxRevenue += amount;
    } else if (kaName === '公債金') {
      fundingSources.publicBonds += amount;
    } else {
      fundingSources.other += amount;
    }

    // 府省庁別に集計（主管ベース）
    if (!byMinistry.has(ministry)) {
      byMinistry.set(ministry, {
        taxRevenue: 0,
        publicBonds: 0,
        insurancePremiums: 0,
        transferFromGeneral: 0,
        other: 0,
        total: 0,
      });
    }
    const ministryFunding = byMinistry.get(ministry)!;
    if (kaName === '租税') {
      ministryFunding.taxRevenue += amount;
    } else if (kaName === '公債金') {
      ministryFunding.publicBonds += amount;
    } else {
      ministryFunding.other += amount;
    }
    ministryFunding.total += amount;
  }

  fundingSources.total =
    fundingSources.taxRevenue +
    fundingSources.publicBonds +
    fundingSources.other;

  return { fundingSources, byMinistry };
}

/**
 * 特別会計歳入データを解析
 */
function parseSpecialAccountRevenue(
  rows: Record<string, string>[],
  amountColumn: string
): {
  specialAccounts: SpecialAccountFunding[];
  transfersToSpecialAccounts: { specialAccountName: string; amount: number }[];
} {
  const accountMap = new Map<string, SpecialAccountFunding>();
  const transfersToSpecialAccounts: { specialAccountName: string; amount: number }[] = [];
  const transferMap = new Map<string, number>();

  for (const row of rows) {
    const specialAccountName = row['特別会計'] || '';
    const accountingName = row['勘定'] || undefined;
    const jurisdiction = row['所管'] || '';
    const koName = row['項名'] || ''; // 項名（収入源）
    const amount = parseAmount(row[amountColumn] || '0');

    // キーを生成（特別会計名 + 勘定名）
    const key = accountingName
      ? `${specialAccountName}_${accountingName}`
      : specialAccountName;

    if (!accountMap.has(key)) {
      accountMap.set(key, {
        specialAccountName,
        accountingName,
        jurisdiction,
        fundingSources: {
          taxRevenue: 0,
          publicBonds: 0,
          insurancePremiums: 0,
          transferFromGeneral: 0,
          other: 0,
          total: 0,
        },
      });
    }

    const account = accountMap.get(key)!;

    // 財源カテゴリ別に集計
    if (koName.includes('保険料')) {
      account.fundingSources.insurancePremiums += amount;
    } else if (koName === '一般会計より受入') {
      account.fundingSources.transferFromGeneral += amount;
      // 一般会計繰入の集計
      const transferKey = specialAccountName + (accountingName ? `_${accountingName}` : '');
      transferMap.set(transferKey, (transferMap.get(transferKey) || 0) + amount);
    } else {
      account.fundingSources.other += amount;
    }
    account.fundingSources.total += amount;
  }

  // 一般会計繰入のリストを作成
  for (const [name, amount] of transferMap.entries()) {
    transfersToSpecialAccounts.push({
      specialAccountName: name,
      amount,
    });
  }

  // 金額順にソート
  transfersToSpecialAccounts.sort((a, b) => b.amount - a.amount);

  return {
    specialAccounts: Array.from(accountMap.values()),
    transfersToSpecialAccounts,
  };
}

/**
 * 府省庁別の財源情報を構築
 */
function buildMinistryFundings(
  generalByMinistry: Map<string, FundingSources>,
  specialAccounts: SpecialAccountFunding[]
): MinistryFunding[] {
  const ministryMap = new Map<string, MinistryFunding>();

  // 一般会計の情報を追加
  for (const [ministryName, funding] of generalByMinistry) {
    if (!ministryMap.has(ministryName)) {
      ministryMap.set(ministryName, {
        ministryName,
        generalAccount: { ...funding },
        specialAccounts: [],
        totalFunding: { ...funding },
      });
    }
  }

  // 特別会計の情報を追加
  for (const sa of specialAccounts) {
    // 所管から府省庁名を抽出（例: "内閣府及び厚生労働省" → "厚生労働省"）
    const jurisdictions = sa.jurisdiction.split(/[、及び]/);
    for (const jurisdiction of jurisdictions) {
      const ministryName = jurisdiction.trim();
      if (!ministryName) continue;

      if (!ministryMap.has(ministryName)) {
        ministryMap.set(ministryName, {
          ministryName,
          generalAccount: {
            taxRevenue: 0,
            publicBonds: 0,
            insurancePremiums: 0,
            transferFromGeneral: 0,
            other: 0,
            total: 0,
          },
          specialAccounts: [],
          totalFunding: {
            taxRevenue: 0,
            publicBonds: 0,
            insurancePremiums: 0,
            transferFromGeneral: 0,
            other: 0,
            total: 0,
          },
        });
      }

      const ministry = ministryMap.get(ministryName)!;
      ministry.specialAccounts.push(sa);

      // 合計に加算
      ministry.totalFunding.insurancePremiums += sa.fundingSources.insurancePremiums;
      ministry.totalFunding.transferFromGeneral += sa.fundingSources.transferFromGeneral;
      ministry.totalFunding.other += sa.fundingSources.other;
      ministry.totalFunding.total += sa.fundingSources.total;
    }
  }

  return Array.from(ministryMap.values()).sort(
    (a, b) => b.totalFunding.total - a.totalFunding.total
  );
}

/**
 * MOF財源データを生成
 */
async function generateMOFFundingData(
  dataType: 'budget' | 'settlement'
): Promise<MOFFundingData> {
  const generalFile =
    dataType === 'budget'
      ? GENERAL_ACCOUNT_REVENUE_FILE
      : GENERAL_ACCOUNT_SETTLEMENT_FILE;
  const specialFile =
    dataType === 'budget'
      ? SPECIAL_ACCOUNT_REVENUE_FILE
      : SPECIAL_ACCOUNT_SETTLEMENT_FILE;

  const amountColumn =
    dataType === 'budget' ? '令和6年度予算額' : '令和6年度予算額';

  // 一般会計歳入データを読み込み
  const generalFilePath = path.join(MOF_DATA_DIR, generalFile);
  if (!fs.existsSync(generalFilePath)) {
    throw new Error(`General account file not found: ${generalFilePath}`);
  }
  console.log(`Reading general account data: ${generalFilePath}`);
  const generalRows = readCSV(generalFilePath);
  console.log(`  Loaded ${generalRows.length} rows`);

  // 特別会計歳入データを読み込み
  const specialFilePath = path.join(MOF_DATA_DIR, specialFile);
  if (!fs.existsSync(specialFilePath)) {
    throw new Error(`Special account file not found: ${specialFilePath}`);
  }
  console.log(`Reading special account data: ${specialFilePath}`);
  const specialRows = readCSV(specialFilePath);
  console.log(`  Loaded ${specialRows.length} rows`);

  // 金額カラム名を確認
  const actualAmountColumn = Object.keys(generalRows[0] || {}).find(
    (key) => key.includes('令和6年度') && (key.includes('予算') || key.includes('予定'))
  );
  const amountCol = actualAmountColumn || amountColumn;
  console.log(`Using amount column: ${amountCol}`);

  // 一般会計の解析
  const { fundingSources: generalAccountTotal, byMinistry: generalByMinistry } =
    parseGeneralAccountRevenue(generalRows, amountCol);

  // 特別会計の解析
  const specialAmountColumn = Object.keys(specialRows[0] || {}).find(
    (key) => key.includes('令和6年度') && (key.includes('予算') || key.includes('予定'))
  );
  const { specialAccounts, transfersToSpecialAccounts } = parseSpecialAccountRevenue(
    specialRows,
    specialAmountColumn || amountCol
  );

  // 府省庁別の財源情報を構築
  const ministryFundings = buildMinistryFundings(generalByMinistry, specialAccounts);

  return {
    generatedAt: new Date().toISOString(),
    fiscalYear: 2024,
    dataType,
    generalAccountTotal,
    transfersToSpecialAccounts,
    specialAccountFundings: specialAccounts,
    ministryFundings,
  };
}

/**
 * 金額をフォーマット（兆円・億円表示）
 */
function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000_000) {
    return `${(amount / 1_000_000_000_000).toFixed(2)}兆円`;
  } else if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)}億円`;
  } else if (amount >= 10_000) {
    return `${(amount / 10_000).toFixed(2)}万円`;
  }
  return `${amount}円`;
}

/**
 * メイン処理
 */
async function main() {
  console.log('=== MOF財源データパーサー ===\n');

  try {
    // 予算データを生成
    console.log('--- Processing budget data ---');
    const budgetData = await generateMOFFundingData('budget');

    // 結果を表示
    console.log('\n=== 一般会計財源構成（予算） ===');
    console.log(`  租税: ${formatAmount(budgetData.generalAccountTotal.taxRevenue)}`);
    console.log(`  公債金: ${formatAmount(budgetData.generalAccountTotal.publicBonds)}`);
    console.log(`  その他: ${formatAmount(budgetData.generalAccountTotal.other)}`);
    console.log(`  合計: ${formatAmount(budgetData.generalAccountTotal.total)}`);

    console.log('\n=== 特別会計への一般会計繰入（上位10） ===');
    budgetData.transfersToSpecialAccounts.slice(0, 10).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.specialAccountName}: ${formatAmount(t.amount)}`);
    });

    console.log('\n=== 特別会計の財源構成（上位10） ===');
    budgetData.specialAccountFundings
      .sort((a, b) => b.fundingSources.total - a.fundingSources.total)
      .slice(0, 10)
      .forEach((sa, i) => {
        const name = sa.accountingName
          ? `${sa.specialAccountName}（${sa.accountingName}）`
          : sa.specialAccountName;
        console.log(`  ${i + 1}. ${name}`);
        console.log(`      保険料: ${formatAmount(sa.fundingSources.insurancePremiums)}`);
        console.log(`      一般会計繰入: ${formatAmount(sa.fundingSources.transferFromGeneral)}`);
        console.log(`      その他: ${formatAmount(sa.fundingSources.other)}`);
        console.log(`      合計: ${formatAmount(sa.fundingSources.total)}`);
      });

    // JSONファイルに出力
    const outputPath = path.join(OUTPUT_DIR, 'mof-funding-2024.json');
    fs.writeFileSync(outputPath, JSON.stringify(budgetData, null, 2));
    console.log(`\n✅ Output written to: ${outputPath}`);

    // 統計情報
    const totalInsurance = budgetData.specialAccountFundings.reduce(
      (sum, sa) => sum + sa.fundingSources.insurancePremiums,
      0
    );
    const totalTransfer = budgetData.specialAccountFundings.reduce(
      (sum, sa) => sum + sa.fundingSources.transferFromGeneral,
      0
    );

    console.log('\n=== 集計結果 ===');
    console.log(`一般会計合計: ${formatAmount(budgetData.generalAccountTotal.total)}`);
    console.log(`  - 租税: ${formatAmount(budgetData.generalAccountTotal.taxRevenue)} (${((budgetData.generalAccountTotal.taxRevenue / budgetData.generalAccountTotal.total) * 100).toFixed(1)}%)`);
    console.log(`  - 公債金: ${formatAmount(budgetData.generalAccountTotal.publicBonds)} (${((budgetData.generalAccountTotal.publicBonds / budgetData.generalAccountTotal.total) * 100).toFixed(1)}%)`);
    console.log(`特別会計`);
    console.log(`  - 保険料: ${formatAmount(totalInsurance)}`);
    console.log(`  - 一般会計繰入: ${formatAmount(totalTransfer)}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
