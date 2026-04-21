/**
 * RSシステムの府省庁別予算とMOF歳出データの対応関係分析スクリプト
 */

import * as fs from 'fs';
import * as path from 'path';

// 型定義
interface RSBudgetSummary {
  projectId: string;
  projectName: string;
  fiscalYear: string;
  budgetYear: string;
  ministry: string;
  totalBudget: number; // 歳出予算現額合計 (円単位)
  initialBudget: number; // 当初予算
  accountType: string; // 会計区分
  account: string; // 会計
}

interface MOFExpenditure {
  shokan: string; // 所管
  organization: string; // 組織
  koumoku: string; // 項名
  mokumei: string; // 目名
  budget: number; // 予算額 (千円単位)
}

interface MOFRevenue {
  shukan: string; // 主管
  buName: string; // 部名
  kanName: string; // 款名
  kouName: string; // 項名
  mokuName: string; // 目名
  budget: number; // 予算額 (千円単位)
}

// シンプルなCSVパーサー（ヘッダー行対応）
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

function readCSV(filePath: string, skipMismatch = false): Record<string, string>[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    const values = parseLine(line);
    if (!skipMismatch && values.length !== headers.length) {
      continue;
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < Math.min(headers.length, values.length); j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

// RSシステムの予算サマリCSVを解析
function parseRSBudgetSummary(dataDir: string): RSBudgetSummary[] {
  const filePath = path.join(dataDir, 'year_2024', '2-1_RS_2024_予算・執行_サマリ.csv');
  const rows = readCSV(filePath);

  const results: RSBudgetSummary[] = [];

  for (const row of rows) {
    // 予算年度2024年のサマリ行（会計区分が空のもの）を抽出
    if (row['予算年度'] === '2024' && !row['会計区分']) {
      const totalBudgetStr = row['計(歳出予算現額合計)'] || '0';
      const initialBudgetStr = row['当初予算(合計)'] || '0';

      results.push({
        projectId: row['予算事業ID'],
        projectName: row['事業名'],
        fiscalYear: row['事業年度'],
        budgetYear: row['予算年度'],
        ministry: row['府省庁'],
        totalBudget: parseFloat(totalBudgetStr) || 0,
        initialBudget: parseFloat(initialBudgetStr) || 0,
        accountType: '',
        account: '',
      });
    }
  }

  return results;
}

// RSシステムの予算種別CSVを解析（会計区分別）
function parseRSBudgetByAccount(dataDir: string): RSBudgetSummary[] {
  const filePath = path.join(dataDir, 'year_2024', '2-2_RS_2024_予算・執行_予算種別・歳出予算項目.csv');
  const rows = readCSV(filePath);

  const results: RSBudgetSummary[] = [];

  for (const row of rows) {
    // 予算年度2024年、当初予算の行を抽出
    if (row['予算年度'] === '2024' && row['予算種別'] === '当初予算') {
      const budgetStr = row['予算額(歳出予算項目ごと)'] || '0';

      results.push({
        projectId: row['予算事業ID'],
        projectName: row['事業名'],
        fiscalYear: row['事業年度'],
        budgetYear: row['予算年度'],
        ministry: row['府省庁'],
        totalBudget: parseFloat(budgetStr) || 0,
        initialBudget: parseFloat(budgetStr) || 0,
        accountType: row['会計区分'],
        account: row['会計'],
      });
    }
  }

  return results;
}

// MOF歳出データを解析
function parseMOFExpenditure(dataDir: string, year: string): MOFExpenditure[] {
  // bファイルが歳出データ
  const mofDir = path.join(dataDir, `mof_${year}`);
  if (!fs.existsSync(mofDir)) {
    console.log(`MOFディレクトリが存在しません: ${mofDir}`);
    return [];
  }

  const files = fs.readdirSync(mofDir).filter(f => f.endsWith('b.csv'));

  const results: MOFExpenditure[] = [];

  for (const file of files) {
    const filePath = path.join(mofDir, file);
    console.log(`  読み込み中: ${file}`);
    const rows = readCSV(filePath, true);

    for (const row of rows) {
      // 予算額のカラム名を動的に取得
      const budgetKey = Object.keys(row).find(k =>
        k.includes('年度要求額') || k.includes('成立予算額')
      );

      if (budgetKey) {
        const budgetStr = row[budgetKey] || '0';
        results.push({
          shokan: row['所管'] || '',
          organization: row['組織'] || '',
          koumoku: row['項名'] || '',
          mokumei: row['目名'] || '',
          budget: parseFloat(budgetStr.replace(/,/g, '')) || 0,
        });
      }
    }
  }

  return results;
}

// MOF歳入データを解析
function parseMOFRevenue(dataDir: string, year: string): MOFRevenue[] {
  // aファイルが歳入データ
  const mofDir = path.join(dataDir, `mof_${year}`);
  if (!fs.existsSync(mofDir)) {
    return [];
  }

  const files = fs.readdirSync(mofDir).filter(f => f.endsWith('a.csv'));

  const results: MOFRevenue[] = [];

  for (const file of files) {
    const filePath = path.join(mofDir, file);
    console.log(`  読み込み中: ${file}`);
    const rows = readCSV(filePath, true);

    for (const row of rows) {
      // 予算額のカラム名を動的に取得
      const budgetKey = Object.keys(row).find(k =>
        k.includes('年度予算額') || k.includes('成立予算額')
      );

      if (budgetKey) {
        const budgetStr = row[budgetKey] || '0';
        results.push({
          shukan: row['主管'] || '',
          buName: row['部名'] || '',
          kanName: row['款名'] || '',
          kouName: row['項名'] || '',
          mokuName: row['目名'] || '',
          budget: parseFloat(budgetStr.replace(/,/g, '')) || 0,
        });
      }
    }
  }

  return results;
}

// 府省庁名のマッピング（RSシステム → MOF）
const ministryMapping: Record<string, string[]> = {
  '内閣官房': ['内閣'],
  '内閣府': ['内閣府'],
  'デジタル庁': ['デジタル庁'],
  '復興庁': ['復興庁'],
  '総務省': ['総務省'],
  '法務省': ['法務省'],
  '外務省': ['外務省'],
  '財務省': ['財務省'],
  '文部科学省': ['文部科学省'],
  '厚生労働省': ['厚生労働省'],
  '農林水産省': ['農林水産省'],
  '経済産業省': ['経済産業省'],
  '国土交通省': ['国土交通省'],
  '環境省': ['環境省'],
  '防衛省': ['防衛省'],
  'こども家庭庁': ['こども家庭庁'],
};

// メイン分析関数
async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const downloadDir = path.join(dataDir, 'download');

  console.log('=== RSシステムとMOFデータの対応関係分析 ===\n');

  // 1. RSシステムの府省庁別予算を集計
  console.log('1. RSシステムの府省庁別予算集計');
  console.log('-'.repeat(60));

  const rsBudgets = parseRSBudgetSummary(dataDir);
  const rsByMinistry = new Map<string, { count: number; totalBudget: number; initialBudget: number }>();

  for (const budget of rsBudgets) {
    const ministry = budget.ministry;
    const existing = rsByMinistry.get(ministry) || { count: 0, totalBudget: 0, initialBudget: 0 };
    existing.count += 1;
    existing.totalBudget += budget.totalBudget;
    existing.initialBudget += budget.initialBudget;
    rsByMinistry.set(ministry, existing);
  }

  // 金額でソート
  const sortedRS = Array.from(rsByMinistry.entries())
    .sort((a, b) => b[1].totalBudget - a[1].totalBudget);

  let rsTotalBudget = 0;
  let rsInitialTotal = 0;
  console.log('\n府省庁名 | 事業数 | 当初予算(兆円) | 歳出予算現額(兆円)');
  console.log('-'.repeat(70));
  for (const [ministry, data] of sortedRS) {
    const initialTrillion = (data.initialBudget / 1_000_000_000_000).toFixed(4);
    const totalTrillion = (data.totalBudget / 1_000_000_000_000).toFixed(4);
    console.log(`${ministry.padEnd(15)} | ${String(data.count).padStart(5)} | ${initialTrillion.padStart(14)} | ${totalTrillion.padStart(18)}`);
    rsTotalBudget += data.totalBudget;
    rsInitialTotal += data.initialBudget;
  }
  console.log('-'.repeat(70));
  console.log(`RS総計: 当初=${(rsInitialTotal / 1_000_000_000_000).toFixed(4)}兆円, 現額=${(rsTotalBudget / 1_000_000_000_000).toFixed(4)}兆円 (${rsBudgets.length}事業)\n`);

  // 2. RSシステムの会計区分別予算を集計
  console.log('\n2. RSシステムの会計区分別予算集計');
  console.log('-'.repeat(60));

  const rsAccountBudgets = parseRSBudgetByAccount(dataDir);
  const rsByAccount = new Map<string, number>();

  for (const budget of rsAccountBudgets) {
    const account = budget.accountType || '(未分類)';
    rsByAccount.set(account, (rsByAccount.get(account) || 0) + budget.totalBudget);
  }

  console.log('\n会計区分 | 予算額(兆円)');
  console.log('-'.repeat(40));
  let accountTotal = 0;
  for (const [account, amount] of Array.from(rsByAccount.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`${account.padEnd(20)} | ${(amount / 1_000_000_000_000).toFixed(4)}`);
    accountTotal += amount;
  }
  console.log('-'.repeat(40));
  console.log(`会計区分別総計: ${(accountTotal / 1_000_000_000_000).toFixed(4)}兆円`);

  // 3. MOF歳出データの所管別集計
  console.log('\n\n3. MOF歳出データの所管別集計（令和6年度＝2024年度）');
  console.log('-'.repeat(60));

  const mofExpenditure = parseMOFExpenditure(downloadDir, '2024');
  const mofByShokan = new Map<string, number>();

  for (const exp of mofExpenditure) {
    const key = exp.shokan;
    if (key) {
      mofByShokan.set(key, (mofByShokan.get(key) || 0) + exp.budget);
    }
  }

  // 金額でソート
  const sortedMOF = Array.from(mofByShokan.entries())
    .sort((a, b) => b[1] - a[1]);

  let mofTotalBudget = 0;
  console.log('\n所管名 | 予算額(兆円) [千円→兆円換算]');
  console.log('-'.repeat(50));
  for (const [shokan, amount] of sortedMOF) {
    // MOFは千円単位なので、兆円に変換するには/1_000_000_000
    const trillion = (amount / 1_000_000_000).toFixed(4);
    console.log(`${shokan.padEnd(20)} | ${trillion}`);
    mofTotalBudget += amount;
  }
  console.log('-'.repeat(50));
  console.log(`MOF歳出総計: ${(mofTotalBudget / 1_000_000_000).toFixed(4)}兆円\n`);

  // 4. MOF歳入データの主管別集計
  console.log('\n4. MOF歳入データの主管別集計（令和6年度＝2024年度）');
  console.log('-'.repeat(60));

  const mofRevenue = parseMOFRevenue(downloadDir, '2024');
  const mofRevenueByShukan = new Map<string, number>();

  for (const rev of mofRevenue) {
    const key = rev.shukan;
    if (key) {
      mofRevenueByShukan.set(key, (mofRevenueByShukan.get(key) || 0) + rev.budget);
    }
  }

  // 金額でソート
  const sortedRevenue = Array.from(mofRevenueByShukan.entries())
    .sort((a, b) => b[1] - a[1]);

  let mofTotalRevenue = 0;
  console.log('\n主管名 | 歳入額(兆円) [千円→兆円換算]');
  console.log('-'.repeat(50));
  for (const [shukan, amount] of sortedRevenue) {
    const trillion = (amount / 1_000_000_000).toFixed(4);
    console.log(`${shukan.padEnd(20)} | ${trillion}`);
    mofTotalRevenue += amount;
  }
  console.log('-'.repeat(50));
  console.log(`MOF歳入総計: ${(mofTotalRevenue / 1_000_000_000).toFixed(4)}兆円\n`);

  // 5. 対応関係分析
  console.log('\n5. RSシステムとMOF歳出データの府省庁別比較');
  console.log('-'.repeat(90));
  console.log('府省庁名(RS)     | RS当初(兆円) | MOF歳出(兆円) | 差額(兆円) | RS/MOF比率');
  console.log('-'.repeat(90));

  for (const [rsMinistry, rsData] of sortedRS) {
    const mofShokan = ministryMapping[rsMinistry]?.[0] || rsMinistry;
    const mofAmount = mofByShokan.get(mofShokan) || 0;

    const rsTrillion = rsData.initialBudget / 1_000_000_000_000;
    const mofTrillion = mofAmount / 1_000_000_000; // 千円単位から兆円へ
    const diffTrillion = rsTrillion - mofTrillion;
    const ratio = mofTrillion > 0 ? (rsTrillion / mofTrillion * 100).toFixed(1) : 'N/A';

    console.log(
      `${rsMinistry.padEnd(15)} | ${rsTrillion.toFixed(4).padStart(12)} | ${mofTrillion.toFixed(4).padStart(13)} | ${diffTrillion.toFixed(4).padStart(10)} | ${String(ratio).padStart(8)}%`
    );
  }
  console.log('-'.repeat(90));
  console.log(`総計: RS=${(rsInitialTotal / 1_000_000_000_000).toFixed(4)}兆円, MOF=${(mofTotalBudget / 1_000_000_000).toFixed(4)}兆円`);

  // 6. MOF歳入の款別集計
  console.log('\n\n6. MOF歳入データの款別集計（上位20件）');
  console.log('-'.repeat(60));

  const mofRevenueByKan = new Map<string, number>();
  for (const rev of mofRevenue) {
    const key = rev.kanName;
    if (key) {
      mofRevenueByKan.set(key, (mofRevenueByKan.get(key) || 0) + rev.budget);
    }
  }

  console.log('\n款名 | 歳入額(兆円)');
  console.log('-'.repeat(60));
  for (const [kan, amount] of Array.from(mofRevenueByKan.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    const trillion = (amount / 1_000_000_000).toFixed(4);
    console.log(`${kan.padEnd(35)} | ${trillion}`);
  }

  // 7. RSの会計別・府省庁別予算（詳細）
  console.log('\n\n7. RS会計区分別・府省庁別予算（一般会計のみ）');
  console.log('-'.repeat(60));

  const rsByAccountMinistry = new Map<string, Map<string, number>>();
  for (const budget of rsAccountBudgets) {
    const account = budget.accountType;
    const ministry = budget.ministry;
    if (!rsByAccountMinistry.has(account)) {
      rsByAccountMinistry.set(account, new Map());
    }
    const ministryMap = rsByAccountMinistry.get(account)!;
    ministryMap.set(ministry, (ministryMap.get(ministry) || 0) + budget.totalBudget);
  }

  const generalAccountBudgets = rsByAccountMinistry.get('一般会計');
  if (generalAccountBudgets) {
    const sortedGeneral = Array.from(generalAccountBudgets.entries())
      .sort((a, b) => b[1] - a[1]);

    console.log('\n府省庁名 | 一般会計予算(兆円)');
    console.log('-'.repeat(50));
    let generalTotal = 0;
    for (const [ministry, amount] of sortedGeneral) {
      console.log(`${ministry.padEnd(20)} | ${(amount / 1_000_000_000_000).toFixed(4)}`);
      generalTotal += amount;
    }
    console.log('-'.repeat(50));
    console.log(`一般会計総計: ${(generalTotal / 1_000_000_000_000).toFixed(4)}兆円`);
  }
}

main().catch(console.error);
