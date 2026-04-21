#!/usr/bin/env npx tsx
/**
 * MOF特別会計繰入データパーサー
 *
 * 一般会計から特別会計への繰入詳細をMOF CSVから抽出する
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 一般会計から特別会計への繰入レコード
 */
interface GeneralToSpecialTransfer {
  specialAccount: string;      // 特別会計名
  accountName: string;          // 勘定名（あれば）
  amount: number;               // 金額（千円）
  source: string;               // 一般会計歳出項目名
  itemName: string;             // 目名
}

/**
 * 特別会計間の繰入レコード
 */
interface SpecialToSpecialTransfer {
  fromAccount: string;          // 繰入元特別会計
  toAccount: string;            // 繰入先特別会計
  amount: number;               // 金額（千円）
  purpose: string;              // 目的・用途
}

/**
 * パース結果
 */
export interface MOFTransferData {
  generalToSpecial: GeneralToSpecialTransfer[];
  specialToSpecial: SpecialToSpecialTransfer[];
}

/**
 * CSVファイルを読み込んでパースする
 */
function parseCSV(filePath: string): string[][] {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  CSVファイルが見つかりません: ${filePath}`);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  return lines.map(line => {
    // シンプルなCSVパース（カンマ区切り）
    return line.split(',').map(cell => cell.trim());
  });
}

/**
 * 一般会計歳出から特別会計繰入を抽出
 */
function parseGeneralAccountTransfers(): GeneralToSpecialTransfer[] {
  const csvPath = path.join(__dirname, '../data/download/mof_2023/DL202311001b.csv');
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    console.warn('⚠️  一般会計歳出CSVが空です');
    return [];
  }

  const transfers: GeneralToSpecialTransfer[] = [];

  // ヘッダー行をスキップ（1行目）
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // カラム構成:
    // 0: 所管, 1: 組織, 2: 項コード, ..., 9: 項名, 10: 目名, 11: 令和5年度要求額(千円), ...
    const itemName = row[9] || '';  // 項名
    const targetName = row[10] || '';  // 目名
    const amountStr = row[11] || '0';  // 令和5年度要求額(千円)

    // 「特別会計へ繰入」を含む項目を抽出
    if (targetName.includes('特別会計へ繰入') || targetName.includes('特会へ繰入')) {
      const amount = parseInt(amountStr, 10) || 0;

      // 特別会計名を抽出（例: "年金特別会計へ繰入" → "年金"）
      let specialAccount = '';

      if (targetName.includes('年金特別会計')) {
        specialAccount = '年金';
      } else if (targetName.includes('交付税及び譲与税配付金特別会計')) {
        specialAccount = '交付税及び譲与税配付金';
      } else if (targetName.includes('国債整理基金特別会計')) {
        specialAccount = '国債整理基金';
      } else if (targetName.includes('エネルギー対策特別会計')) {
        specialAccount = 'エネルギー対策';
      } else if (targetName.includes('食料安定供給特別会計')) {
        specialAccount = '食料安定供給';
      } else if (targetName.includes('労働保険特別会計')) {
        specialAccount = '労働保険';
      } else if (targetName.includes('自動車安全特別会計')) {
        specialAccount = '自動車安全';
      } else if (targetName.includes('東日本大震災復興特別会計')) {
        specialAccount = '東日本大震災復興';
      } else if (targetName.includes('国有林野事業債務管理特別会計')) {
        specialAccount = '国有林野事業債務管理';
      } else if (targetName.includes('特許特別会計')) {
        specialAccount = '特許';
      } else {
        // その他の特別会計
        const match = targetName.match(/(.+?)特別会計へ繰入/);
        if (match) {
          specialAccount = match[1];
        } else {
          specialAccount = 'その他';
        }
      }

      transfers.push({
        specialAccount,
        accountName: '',  // 一般会計歳出側には勘定情報なし
        amount,
        source: itemName,
        itemName: targetName,
      });
    }
  }

  console.log(`✅ 一般会計繰入: ${transfers.length}件抽出`);
  return transfers;
}

/**
 * 特別会計歳入から一般会計繰入を抽出（検証用）
 */
function parseSpecialAccountRevenue(): GeneralToSpecialTransfer[] {
  const csvPath = path.join(__dirname, '../data/download/mof_2023/DL202312001a.csv');
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    console.warn('⚠️  特別会計歳入CSVが空です');
    return [];
  }

  const transfers: GeneralToSpecialTransfer[] = [];

  // ヘッダー行をスキップ
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    // カラム構成:
    // 0: 所管, 1: 特別会計, 2: 勘定, ..., 8: 目名, 9: 令和5年度予定額(千円), ...
    const specialAccount = row[1] || '';
    const accountName = row[2] || '';
    const targetName = row[8] || '';
    const amountStr = row[9] || '0';

    // 「一般会計より受入」を含む項目を抽出
    if (targetName.includes('一般会計より受入')) {
      const amount = parseInt(amountStr, 10) || 0;

      transfers.push({
        specialAccount,
        accountName,
        amount,
        source: '一般会計より受入',
        itemName: targetName,
      });
    }
  }

  console.log(`✅ 特別会計歳入（一般会計繰入）: ${transfers.length}件抽出`);
  return transfers;
}

/**
 * 特別会計間の繰入を抽出
 */
function parseSpecialToSpecialTransfers(): SpecialToSpecialTransfer[] {
  const csvPath = path.join(__dirname, '../data/download/mof_2023/DL202312001a.csv');
  const rows = parseCSV(csvPath);

  if (rows.length === 0) {
    return [];
  }

  const transfers: SpecialToSpecialTransfer[] = [];

  // ヘッダー行をスキップ
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const toAccount = row[1] || '';
    const targetName = row[8] || '';
    const amountStr = row[9] || '0';

    // 「特別会計より受入」を含む項目を抽出（一般会計以外）
    if (targetName.includes('特別会計より受入') && !targetName.includes('一般会計より受入')) {
      const amount = parseInt(amountStr, 10) || 0;

      // 繰入元特別会計名を抽出
      let fromAccount = '';
      const match = targetName.match(/(.+?)特別会計より受入/);
      if (match) {
        fromAccount = match[1];
      }

      if (fromAccount) {
        transfers.push({
          fromAccount,
          toAccount,
          amount,
          purpose: targetName,
        });
      }
    }
  }

  console.log(`✅ 特別会計間繰入: ${transfers.length}件抽出`);
  return transfers;
}

/**
 * 繰入データを集約
 */
function aggregateTransfers(transfers: GeneralToSpecialTransfer[]): Map<string, number> {
  const aggregated = new Map<string, number>();

  for (const transfer of transfers) {
    const current = aggregated.get(transfer.specialAccount) || 0;
    aggregated.set(transfer.specialAccount, current + transfer.amount);
  }

  return aggregated;
}

/**
 * メイン処理
 */
export function parseMOFTransferData(): MOFTransferData {
  console.log('\n=== MOF特別会計繰入データ抽出 ===\n');

  // 一般会計歳出側から抽出
  const generalToSpecial = parseGeneralAccountTransfers();

  // 特別会計歳入側から抽出（検証用）
  const specialAccountRevenue = parseSpecialAccountRevenue();

  // 特別会計間繰入を抽出
  const specialToSpecial = parseSpecialToSpecialTransfers();

  // 集計結果を表示
  console.log('\n--- 一般会計繰入集計（歳出側） ---');
  const aggregatedGeneral = aggregateTransfers(generalToSpecial);
  const sortedGeneral = Array.from(aggregatedGeneral.entries())
    .sort((a, b) => b[1] - a[1]);

  let totalGeneral = 0;
  for (const [account, amount] of sortedGeneral) {
    console.log(`  ${account.padEnd(30)} ${(amount / 1e9).toFixed(2).padStart(10)}兆円`);
    totalGeneral += amount;
  }
  console.log(`  ${'合計'.padEnd(30)} ${(totalGeneral / 1e9).toFixed(2).padStart(10)}兆円`);

  console.log('\n--- 一般会計繰入集計（歳入側） ---');
  const aggregatedSpecial = aggregateTransfers(specialAccountRevenue);
  const sortedSpecial = Array.from(aggregatedSpecial.entries())
    .sort((a, b) => b[1] - a[1]);

  let totalSpecial = 0;
  for (const [account, amount] of sortedSpecial) {
    console.log(`  ${account.padEnd(30)} ${(amount / 1e9).toFixed(2).padStart(10)}兆円`);
    totalSpecial += amount;
  }
  console.log(`  ${'合計'.padEnd(30)} ${(totalSpecial / 1e9).toFixed(2).padStart(10)}兆円`);

  // 整合性チェック
  const diff = Math.abs(totalGeneral - totalSpecial);
  if (diff > 1e9) {  // 10億円以上の差異
    console.warn(`\n⚠️  警告: 歳出側と歳入側で ${(diff / 1e9).toFixed(2)}兆円の差異があります`);
  } else {
    console.log(`\n✅ 整合性チェックOK（差異: ${(diff / 1e9).toFixed(2)}兆円）`);
  }

  return {
    generalToSpecial,
    specialToSpecial,
  };
}

// スクリプトとして実行された場合
if (import.meta.url === `file://${process.argv[1]}`) {
  parseMOFTransferData();
}
