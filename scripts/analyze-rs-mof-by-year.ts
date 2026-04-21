/**
 * RSシステムとMOFデータの年度別集計分析スクリプト
 */

import * as fs from 'fs';
import * as path from 'path';

// シンプルなCSVパーサー
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

// RSシステムの予算サマリを年度別に解析
function parseRSBudgetByYear(dataDir: string): Map<string, { count: number; initialBudget: number; totalBudget: number }> {
  const filePath = path.join(dataDir, 'year_2024', '2-1_RS_2024_予算・執行_サマリ.csv');
  const rows = readCSV(filePath);

  const byYear = new Map<string, { count: number; initialBudget: number; totalBudget: number }>();

  for (const row of rows) {
    // サマリ行（会計区分が空のもの）を抽出
    if (!row['会計区分']) {
      const budgetYear = row['予算年度'];
      if (!budgetYear) continue;

      const totalBudgetStr = row['計(歳出予算現額合計)'] || '0';
      const initialBudgetStr = row['当初予算(合計)'] || '0';

      const existing = byYear.get(budgetYear) || { count: 0, initialBudget: 0, totalBudget: 0 };
      existing.count += 1;
      existing.initialBudget += parseFloat(initialBudgetStr) || 0;
      existing.totalBudget += parseFloat(totalBudgetStr) || 0;
      byYear.set(budgetYear, existing);
    }
  }

  return byYear;
}

// RSシステムの府省庁・年度別予算を解析
function parseRSBudgetByMinistryYear(dataDir: string): Map<string, Map<string, { count: number; initialBudget: number; totalBudget: number }>> {
  const filePath = path.join(dataDir, 'year_2024', '2-1_RS_2024_予算・執行_サマリ.csv');
  const rows = readCSV(filePath);

  // ministry -> year -> data
  const byMinistryYear = new Map<string, Map<string, { count: number; initialBudget: number; totalBudget: number }>>();

  for (const row of rows) {
    if (!row['会計区分']) {
      const ministry = row['府省庁'];
      const budgetYear = row['予算年度'];
      if (!ministry || !budgetYear) continue;

      if (!byMinistryYear.has(ministry)) {
        byMinistryYear.set(ministry, new Map());
      }
      const ministryMap = byMinistryYear.get(ministry)!;

      const totalBudgetStr = row['計(歳出予算現額合計)'] || '0';
      const initialBudgetStr = row['当初予算(合計)'] || '0';

      const existing = ministryMap.get(budgetYear) || { count: 0, initialBudget: 0, totalBudget: 0 };
      existing.count += 1;
      existing.initialBudget += parseFloat(initialBudgetStr) || 0;
      existing.totalBudget += parseFloat(totalBudgetStr) || 0;
      ministryMap.set(budgetYear, existing);
    }
  }

  return byMinistryYear;
}

// RSシステムの会計区分・年度別予算を解析
function parseRSBudgetByAccountYear(dataDir: string): Map<string, Map<string, number>> {
  const filePath = path.join(dataDir, 'year_2024', '2-2_RS_2024_予算・執行_予算種別・歳出予算項目.csv');
  const rows = readCSV(filePath);

  // account -> year -> amount
  const byAccountYear = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (row['予算種別'] === '当初予算') {
      const account = row['会計区分'] || '(未分類)';
      const budgetYear = row['予算年度'];
      if (!budgetYear) continue;

      if (!byAccountYear.has(account)) {
        byAccountYear.set(account, new Map());
      }
      const yearMap = byAccountYear.get(account)!;

      const budgetStr = row['予算額(歳出予算項目ごと)'] || '0';
      yearMap.set(budgetYear, (yearMap.get(budgetYear) || 0) + (parseFloat(budgetStr) || 0));
    }
  }

  return byAccountYear;
}

// MOF歳出データを年度別に解析
function parseMOFExpenditureByYear(dataDir: string, year: string): { total: number; byShokan: Map<string, number> } {
  const mofDir = path.join(dataDir, `mof_${year}`);
  if (!fs.existsSync(mofDir)) {
    return { total: 0, byShokan: new Map() };
  }

  const files = fs.readdirSync(mofDir).filter(f => f.endsWith('b.csv'));
  const byShokan = new Map<string, number>();
  let total = 0;

  for (const file of files) {
    const filePath = path.join(mofDir, file);
    const rows = readCSV(filePath, true);

    for (const row of rows) {
      const budgetKey = Object.keys(row).find(k =>
        k.includes('年度要求額') || k.includes('成立予算額')
      );

      if (budgetKey) {
        const budgetStr = row[budgetKey] || '0';
        const budget = parseFloat(budgetStr.replace(/,/g, '')) || 0;
        const shokan = row['所管'] || '';

        if (shokan) {
          byShokan.set(shokan, (byShokan.get(shokan) || 0) + budget);
          total += budget;
        }
      }
    }
  }

  return { total, byShokan };
}

// MOF歳入データを年度別に解析
function parseMOFRevenueByYear(dataDir: string, year: string): { total: number; byKan: Map<string, number> } {
  const mofDir = path.join(dataDir, `mof_${year}`);
  if (!fs.existsSync(mofDir)) {
    return { total: 0, byKan: new Map() };
  }

  const files = fs.readdirSync(mofDir).filter(f => f.endsWith('a.csv'));
  const byKan = new Map<string, number>();
  let total = 0;

  for (const file of files) {
    const filePath = path.join(mofDir, file);
    const rows = readCSV(filePath, true);

    for (const row of rows) {
      const budgetKey = Object.keys(row).find(k =>
        k.includes('年度予算額') || k.includes('成立予算額')
      );

      if (budgetKey) {
        const budgetStr = row[budgetKey] || '0';
        const budget = parseFloat(budgetStr.replace(/,/g, '')) || 0;
        const kan = row['款名'] || '';

        if (kan) {
          byKan.set(kan, (byKan.get(kan) || 0) + budget);
          total += budget;
        }
      }
    }
  }

  return { total, byKan };
}

// メイン関数
async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const downloadDir = path.join(dataDir, 'download');

  console.log('=== RSシステムとMOFデータの年度別集計分析 ===\n');

  // 1. RSシステムの年度別予算
  console.log('## 1. RSシステム予算年度別集計');
  console.log('-'.repeat(70));

  const rsByYear = parseRSBudgetByYear(dataDir);
  const sortedYears = Array.from(rsByYear.keys()).sort();

  console.log('\n| 予算年度 | 事業数 | 当初予算（兆円） | 歳出予算現額（兆円） |');
  console.log('|----------|--------|-----------------|-------------------|');
  for (const year of sortedYears) {
    const data = rsByYear.get(year)!;
    console.log(`| ${year} | ${data.count.toLocaleString().padStart(6)} | ${(data.initialBudget / 1_000_000_000_000).toFixed(4).padStart(15)} | ${(data.totalBudget / 1_000_000_000_000).toFixed(4).padStart(17)} |`);
  }

  // 2. RSシステムの会計区分・年度別予算
  console.log('\n\n## 2. RSシステム会計区分・年度別集計（当初予算）');
  console.log('-'.repeat(70));

  const rsByAccountYear = parseRSBudgetByAccountYear(dataDir);
  const accounts = Array.from(rsByAccountYear.keys()).sort();
  const allYears = new Set<string>();
  for (const yearMap of rsByAccountYear.values()) {
    for (const year of yearMap.keys()) {
      allYears.add(year);
    }
  }
  const sortedAllYears = Array.from(allYears).sort();

  console.log('\n| 会計区分 | ' + sortedAllYears.map(y => `${y}年度（兆円）`).join(' | ') + ' |');
  console.log('|----------|' + sortedAllYears.map(() => '-------------').join('|') + '|');
  for (const account of accounts) {
    const yearMap = rsByAccountYear.get(account)!;
    const values = sortedAllYears.map(y => {
      const amount = yearMap.get(y) || 0;
      return (amount / 1_000_000_000_000).toFixed(4).padStart(11);
    });
    console.log(`| ${account.padEnd(8)} | ${values.join(' | ')} |`);
  }

  // 年度別合計
  console.log('|----------|' + sortedAllYears.map(() => '-------------').join('|') + '|');
  const yearTotals = sortedAllYears.map(y => {
    let total = 0;
    for (const yearMap of rsByAccountYear.values()) {
      total += yearMap.get(y) || 0;
    }
    return (total / 1_000_000_000_000).toFixed(4).padStart(11);
  });
  console.log(`| 合計     | ${yearTotals.join(' | ')} |`);

  // 3. RSシステムの主要府省庁・年度別予算
  console.log('\n\n## 3. RSシステム主要府省庁・年度別集計（当初予算、2024年度予算上位10府省庁）');
  console.log('-'.repeat(90));

  const rsByMinistryYear = parseRSBudgetByMinistryYear(dataDir);

  // 2024年度の予算額でソート
  const ministriesWith2024 = Array.from(rsByMinistryYear.entries())
    .filter(([_, yearMap]) => yearMap.has('2024'))
    .sort((a, b) => {
      const a2024 = a[1].get('2024')?.initialBudget || 0;
      const b2024 = b[1].get('2024')?.initialBudget || 0;
      return b2024 - a2024;
    })
    .slice(0, 10);

  console.log('\n| 府省庁名 | ' + sortedAllYears.map(y => `${y}年度（兆円）`).join(' | ') + ' |');
  console.log('|----------|' + sortedAllYears.map(() => '-------------').join('|') + '|');
  for (const [ministry, yearMap] of ministriesWith2024) {
    const values = sortedAllYears.map(y => {
      const data = yearMap.get(y);
      const amount = data?.initialBudget || 0;
      return (amount / 1_000_000_000_000).toFixed(4).padStart(11);
    });
    console.log(`| ${ministry.padEnd(14)} | ${values.join(' | ')} |`);
  }

  // 4. MOFデータの年度別集計
  console.log('\n\n## 4. MOFデータ年度別集計');
  console.log('-'.repeat(70));

  const mofYears = ['2023', '2024'];
  console.log('\n### 4.1 MOF歳出総計');
  console.log('\n| 年度 | 歳出総計（兆円） |');
  console.log('|------|----------------|');
  for (const year of mofYears) {
    const mofExp = parseMOFExpenditureByYear(downloadDir, year);
    console.log(`| ${year} | ${(mofExp.total / 1_000_000_000).toFixed(4).padStart(14)} |`);
  }

  console.log('\n### 4.2 MOF歳入総計');
  console.log('\n| 年度 | 歳入総計（兆円） |');
  console.log('|------|----------------|');
  for (const year of mofYears) {
    const mofRev = parseMOFRevenueByYear(downloadDir, year);
    console.log(`| ${year} | ${(mofRev.total / 1_000_000_000).toFixed(4).padStart(14)} |`);
  }

  // 5. MOF歳入の款別・年度別集計
  console.log('\n### 4.3 MOF歳入款別集計（上位10件）');
  console.log('\n| 款名 | 2023年度（兆円） | 2024年度（兆円） | 増減（兆円） |');
  console.log('|------|-----------------|-----------------|-------------|');

  const mofRev2023 = parseMOFRevenueByYear(downloadDir, '2023');
  const mofRev2024 = parseMOFRevenueByYear(downloadDir, '2024');

  // 2024年度でソート
  const sortedKan = Array.from(mofRev2024.byKan.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [kan, amount2024] of sortedKan) {
    const amount2023 = mofRev2023.byKan.get(kan) || 0;
    const diff = amount2024 - amount2023;
    console.log(`| ${kan.padEnd(30)} | ${(amount2023 / 1_000_000_000).toFixed(4).padStart(15)} | ${(amount2024 / 1_000_000_000).toFixed(4).padStart(15)} | ${(diff / 1_000_000_000).toFixed(4).padStart(11)} |`);
  }

  // 6. MOF歳出の所管別・年度別集計
  console.log('\n### 4.4 MOF歳出所管別集計（上位10件）');
  console.log('\n| 所管名 | 2023年度（兆円） | 2024年度（兆円） | 増減（兆円） |');
  console.log('|--------|-----------------|-----------------|-------------|');

  const mofExp2023 = parseMOFExpenditureByYear(downloadDir, '2023');
  const mofExp2024 = parseMOFExpenditureByYear(downloadDir, '2024');

  // 2024年度でソート
  const sortedShokan = Array.from(mofExp2024.byShokan.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [shokan, amount2024] of sortedShokan) {
    const amount2023 = mofExp2023.byShokan.get(shokan) || 0;
    const diff = amount2024 - amount2023;
    console.log(`| ${shokan.padEnd(30)} | ${(amount2023 / 1_000_000_000).toFixed(4).padStart(15)} | ${(amount2024 / 1_000_000_000).toFixed(4).padStart(15)} | ${(diff / 1_000_000_000).toFixed(4).padStart(11)} |`);
  }

  // 7. RSシステムとMOFの年度別比較
  console.log('\n\n## 5. RSシステムとMOF歳出の年度別比較');
  console.log('-'.repeat(70));
  console.log('\n| 年度 | RS当初予算（兆円） | MOF歳出（兆円） | RS/MOF比率 |');
  console.log('|------|-------------------|----------------|-----------|');

  const rsYear2023 = rsByYear.get('2023');
  const rsYear2024 = rsByYear.get('2024');

  if (rsYear2023) {
    const ratio = (rsYear2023.initialBudget / 1_000_000_000_000) / (mofExp2023.total / 1_000_000_000) * 100;
    console.log(`| 2023 | ${(rsYear2023.initialBudget / 1_000_000_000_000).toFixed(4).padStart(17)} | ${(mofExp2023.total / 1_000_000_000).toFixed(4).padStart(14)} | ${ratio.toFixed(1).padStart(8)}% |`);
  }
  if (rsYear2024) {
    const ratio = (rsYear2024.initialBudget / 1_000_000_000_000) / (mofExp2024.total / 1_000_000_000) * 100;
    console.log(`| 2024 | ${(rsYear2024.initialBudget / 1_000_000_000_000).toFixed(4).padStart(17)} | ${(mofExp2024.total / 1_000_000_000).toFixed(4).padStart(14)} | ${ratio.toFixed(1).padStart(8)}% |`);
  }
}

main().catch(console.error);
