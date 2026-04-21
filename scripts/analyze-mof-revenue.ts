import fs from 'fs';
import path from 'path';

interface RevenueRecord {
  department: string;      // 主管
  sectionName: string;     // 款名
  itemName: string;        // 項名
  detailName: string;      // 目名
  fy2023Amount: number;    // 令和5年度予算額(千円)
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

function parseRevenueCSV(filePath: string): RevenueRecord[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const records: RevenueRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);

    if (cols.length < 10) continue;

    const department = cols[0];
    const sectionName = cols[6];    // 款名
    const itemName = cols[7];       // 項名
    const detailName = cols[8];     // 目名
    const amountStr = cols[9];      // 令和5年度予算額(千円)

    const amount = parseInt(amountStr.replace(/,/g, ''), 10);

    if (isNaN(amount)) continue;

    records.push({
      department,
      sectionName,
      itemName,
      detailName,
      fy2023Amount: amount,
    });
  }

  return records;
}

function aggregateBySection(records: RevenueRecord[]): Map<string, number> {
  const sectionMap = new Map<string, number>();

  for (const record of records) {
    const current = sectionMap.get(record.sectionName) || 0;
    sectionMap.set(record.sectionName, current + record.fy2023Amount);
  }

  return sectionMap;
}

function main() {
  console.log('='.repeat(80));
  console.log('MOF 2023年度 一般会計歳入分析');
  console.log('='.repeat(80));
  console.log();

  // 2023年度（令和5年度）一般会計歳入
  const file2023 = path.join(process.cwd(), 'data/download/mof_2023/DL202311001a.csv');

  console.log('【2023年度（令和5年度）一般会計歳入】');
  console.log('-'.repeat(80));

  const records2023 = parseRevenueCSV(file2023);
  const sectionMap2023 = aggregateBySection(records2023);

  // 款名でソート（金額降順）
  const sortedSections2023 = Array.from(sectionMap2023.entries())
    .sort((a, b) => b[1] - a[1]);

  let total2023 = 0;

  console.log();
  console.log('款名別集計（金額降順）:');
  console.log();
  console.log('順位 | 款名 | 金額（千円） | 金額（兆円） | 構成比');
  console.log('-'.repeat(80));

  sortedSections2023.forEach(([section, amount], index) => {
    const amountTrillion = (amount / 1_000_000_000).toFixed(2);
    total2023 += amount;
  });

  sortedSections2023.forEach(([section, amount], index) => {
    const amountTrillion = (amount / 1_000_000_000).toFixed(2);
    const ratio = ((amount / total2023) * 100).toFixed(1);
    console.log(`${(index + 1).toString().padStart(2)} | ${section.padEnd(30)} | ${amount.toLocaleString().padStart(20)} | ${amountTrillion.padStart(12)} | ${ratio.padStart(6)}%`);
  });

  console.log('-'.repeat(80));
  console.log(`合計 | ${' '.padEnd(30)} | ${total2023.toLocaleString().padStart(20)} | ${(total2023 / 1_000_000_000).toFixed(2).padStart(12)} | 100.0%`);
  console.log();

  // 主要カテゴリの抽出
  console.log();
  console.log('【主要カテゴリ】');
  console.log('-'.repeat(80));

  const taxRevenue = sectionMap2023.get('租税及印紙収入') || 0;
  const bondRevenue = sectionMap2023.get('公債金') || 0;
  const otherRevenue = total2023 - taxRevenue - bondRevenue;

  console.log();
  console.log(`租税及印紙収入: ${(taxRevenue / 1_000_000_000).toFixed(2)} 兆円 (${((taxRevenue / total2023) * 100).toFixed(1)}%)`);
  console.log(`公債金（新規国債発行）: ${(bondRevenue / 1_000_000_000).toFixed(2)} 兆円 (${((bondRevenue / total2023) * 100).toFixed(1)}%)`);
  console.log(`その他収入: ${(otherRevenue / 1_000_000_000).toFixed(2)} 兆円 (${((otherRevenue / total2023) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`一般会計歳入総額: ${(total2023 / 1_000_000_000).toFixed(2)} 兆円`);
  console.log();

  // 租税収入の内訳
  console.log();
  console.log('【租税収入の詳細内訳（項名別）】');
  console.log('-'.repeat(80));

  const taxRecords = records2023.filter(r => r.sectionName === '租税');
  const taxItemMap = new Map<string, number>();

  for (const record of taxRecords) {
    const current = taxItemMap.get(record.itemName) || 0;
    taxItemMap.set(record.itemName, current + record.fy2023Amount);
  }

  const sortedTaxItems = Array.from(taxItemMap.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log();
  console.log('順位 | 税目（項名） | 金額（千円） | 金額（兆円） | 構成比');
  console.log('-'.repeat(80));

  const taxTotal = sortedTaxItems.reduce((sum, [, amount]) => sum + amount, 0);

  sortedTaxItems.forEach(([item, amount], index) => {
    const amountTrillion = (amount / 1_000_000_000).toFixed(2);
    const ratio = ((amount / taxTotal) * 100).toFixed(1);
    console.log(`${(index + 1).toString().padStart(2)} | ${item.padEnd(30)} | ${amount.toLocaleString().padStart(20)} | ${amountTrillion.padStart(12)} | ${ratio.padStart(6)}%`);
  });

  console.log('-'.repeat(80));
  console.log(`合計 | ${' '.padEnd(30)} | ${taxTotal.toLocaleString().padStart(20)} | ${(taxTotal / 1_000_000_000).toFixed(2).padStart(12)} | 100.0%`);
  console.log();

  // その他収入の内訳
  console.log();
  console.log('【その他収入の詳細内訳（款名別）】');
  console.log('-'.repeat(80));

  const otherSections = sortedSections2023.filter(([section]) =>
    section !== '租税及印紙収入' && section !== '公債金'
  );

  console.log();
  console.log('順位 | 款名 | 金額（千円） | 金額（兆円） | 構成比');
  console.log('-'.repeat(80));

  otherSections.forEach(([section, amount], index) => {
    const amountTrillion = (amount / 1_000_000_000).toFixed(2);
    const ratio = ((amount / otherRevenue) * 100).toFixed(1);
    console.log(`${(index + 1).toString().padStart(2)} | ${section.padEnd(30)} | ${amount.toLocaleString().padStart(20)} | ${amountTrillion.padStart(12)} | ${ratio.padStart(6)}%`);
  });

  console.log('-'.repeat(80));
  console.log(`合計 | ${' '.padEnd(30)} | ${otherRevenue.toLocaleString().padStart(20)} | ${(otherRevenue / 1_000_000_000).toFixed(2).padStart(12)} | 100.0%`);
  console.log();

  console.log('='.repeat(80));
}

main();
