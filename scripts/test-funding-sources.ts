#!/usr/bin/env npx ts-node
/**
 * 財源情報の統合テスト
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MOF財源データを読み込み
const mofDataPath = path.join(__dirname, '../public/data/mof-funding-2024.json');
const mofData = JSON.parse(fs.readFileSync(mofDataPath, 'utf-8'));

console.log('=== MOF財源データ統合テスト ===\n');

// RSシステムの府省庁名からMOF形式への変換マップ
const RS_TO_MOF_MAPPING: Record<string, string> = {
  '内閣官房': '内閣',
  '警察庁': '内閣府',
  '金融庁': '内閣府',
  '消費者庁': '内閣府',
  '個人情報保護委員会': '内閣府',
  '公害等調整委員会': '総務省',
  '消防庁': '総務省',
  '公安調査庁': '法務省',
  '出入国在留管理庁': '法務省',
  '公正取引委員会': '内閣府',
  '国家公安委員会': '内閣府',
  '宮内庁': '内閣府',
  '特許庁': '経済産業省',
  '中小企業庁': '経済産業省',
  '資源エネルギー庁': '経済産業省',
  '気象庁': '国土交通省',
  '海上保安庁': '国土交通省',
  '観光庁': '国土交通省',
  '林野庁': '農林水産省',
  '水産庁': '農林水産省',
  '文化庁': '文部科学省',
  'スポーツ庁': '文部科学省',
  '原子力規制委員会': '環境省',
  '検察庁': '法務省',
};

function getMinistryFundingSources(ministryName: string) {
  const mofMinistryName = RS_TO_MOF_MAPPING[ministryName] || ministryName;
  const ministryFunding = mofData.ministryFundings.find(
    (m: { ministryName: string }) => m.ministryName === mofMinistryName
  );
  return ministryFunding?.totalFunding;
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000_000) {
    return `${(amount / 1_000_000_000_000).toFixed(2)}兆円`;
  } else if (amount >= 100_000_000) {
    return `${(amount / 100_000_000).toFixed(2)}億円`;
  }
  return `${amount}円`;
}

// テスト: 主要府省庁の財源情報を表示
const testMinistries = [
  '厚生労働省',
  '財務省',
  '国土交通省',
  '文部科学省',
  '防衛省',
  '農林水産省',
  '警察庁',  // 内閣府にマッピング
  '消防庁',  // 総務省にマッピング
];

console.log('--- 府省庁別財源情報 ---\n');

for (const ministry of testMinistries) {
  const funding = getMinistryFundingSources(ministry);
  const mofMinistryName = RS_TO_MOF_MAPPING[ministry] || ministry;
  console.log(`${ministry}${ministry !== mofMinistryName ? ` → ${mofMinistryName}` : ''}`);

  if (funding) {
    console.log(`  租税: ${formatAmount(funding.taxRevenue)}`);
    console.log(`  公債金: ${formatAmount(funding.publicBonds)}`);
    console.log(`  保険料: ${formatAmount(funding.insurancePremiums)}`);
    console.log(`  一般会計繰入: ${formatAmount(funding.transferFromGeneral)}`);
    console.log(`  その他: ${formatAmount(funding.other)}`);
    console.log(`  合計: ${formatAmount(funding.total)}`);
  } else {
    console.log(`  財源情報なし`);
  }
  console.log('');
}

// 統計サマリ
console.log('--- 全体サマリ ---');
console.log(`一般会計財源構成:`);
console.log(`  租税: ${formatAmount(mofData.generalAccountTotal.taxRevenue)}`);
console.log(`  公債金: ${formatAmount(mofData.generalAccountTotal.publicBonds)}`);
console.log(`  その他: ${formatAmount(mofData.generalAccountTotal.other)}`);
console.log(`  合計: ${formatAmount(mofData.generalAccountTotal.total)}`);

console.log('\n✅ テスト完了');
