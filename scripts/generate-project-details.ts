#!/usr/bin/env tsx

/**
 * 事業詳細データ生成スクリプト
 *
 * 入力: data/year_{YEAR}/1-2_RS_{YEAR}_基本情報_事業概要等.csv
 * 出力: public/data/rs{YEAR}-project-details.json
 *
 * 実行方法:
 *   npm run generate-project-details          # 2024年度
 *   npm run generate-project-details -- 2025  # 2025年度
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ProjectDetail, ProjectDetailsData, ImplementationMethod } from '@/types/project-details';

// 年度: コマンドライン引数 or デフォルト 2024
const YEAR = process.argv[2] ?? '2024';
const PROJECT_OVERVIEW_CSV = `data/year_${YEAR}/1-2_RS_${YEAR}_基本情報_事業概要等.csv`;
const OUTPUT_JSON = `public/data/rs${YEAR}-project-details.json`;

/**
 * CSV行を解析してフィールド配列に分割
 * ダブルクォート囲みのフィールドに対応
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      // エスケープされたダブルクォート
      currentField += '"';
      i++; // 次の文字をスキップ
    } else if (char === '"') {
      // クォートの開始/終了
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // フィールド区切り
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // 最後のフィールドを追加
  fields.push(currentField.trim());

  return fields;
}

/**
 * CSV文字列を行配列にパース
 */
function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/);
  const rows: string[][] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue; // 空行をスキップ
    rows.push(parseCSVLine(trimmed));
  }

  return rows;
}

/**
 * CSV列インデックス（0-indexed）
 */
const COL = {
  PROJECT_ID: 2,           // 予算事業ID
  PROJECT_NAME: 3,         // 事業名
  MINISTRY: 6,             // 府省庁
  BUREAU: 7,               // 局・庁
  PURPOSE: 13,             // 事業の目的
  CURRENT_ISSUES: 14,      // 現状・課題
  OVERVIEW: 15,            // 事業の概要
  URL: 16,                 // 事業概要URL
  CATEGORY: 17,            // 事業区分
  START_YEAR: 18,          // 事業開始年度
  START_YEAR_UNKNOWN: 19,  // 開始年度不明
  END_YEAR: 20,            // 事業終了(予定)年度
  NO_END_DATE: 21,         // 終了予定なし
  MAJOR_EXPENSE: 22,       // 主要経費
  REMARKS: 23,             // 備考
  IMPL_DIRECT: 24,         // 実施方法ー直接実施
  IMPL_SUBSIDY: 25,        // 実施方法ー補助
  IMPL_BURDEN: 26,         // 実施方法ー負担
  IMPL_GRANT: 27,          // 実施方法ー交付
  IMPL_CONTRIBUTION: 28,   // 実施方法ー分担金・拠出金
  IMPL_OTHER: 29,          // 実施方法ーその他
  OLD_PROJECT_NUM: 30,     // 旧事業番号
} as const;

/**
 * 実施方法のフラグを配列に変換
 */
function parseImplementationMethods(row: string[]): ImplementationMethod[] {
  const methods: ImplementationMethod[] = [];

  if (row[COL.IMPL_DIRECT] === '1') methods.push('直接実施');
  if (row[COL.IMPL_SUBSIDY] === '1') methods.push('補助');
  if (row[COL.IMPL_BURDEN] === '1') methods.push('負担');
  if (row[COL.IMPL_GRANT] === '1') methods.push('交付');
  if (row[COL.IMPL_CONTRIBUTION] === '1') methods.push('分担金・拠出金');
  if (row[COL.IMPL_OTHER] === '1') methods.push('その他');

  return methods;
}

/**
 * 年度のパース（空文字列の場合はnull）
 */
function parseYear(value: string): number | null {
  if (!value || value.trim() === '') return null;
  const num = parseInt(value, 10);
  return isNaN(num) ? null : num;
}

/**
 * TRUE/FALSEのパース
 */
function parseBoolean(value: string): boolean {
  return value.trim().toUpperCase() === 'TRUE';
}

/**
 * URLのパース（空文字列の場合はnull）
 */
function parseURL(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 文字列の正規化（空白のトリミング、空の場合は空文字列）
 */
function normalizeString(value: string): string {
  return value ? value.trim() : '';
}

/**
 * メイン処理
 */
function main() {
  console.log(`事業詳細データ生成スクリプト開始... (年度: ${YEAR})`);
  console.log(`入力CSV: ${PROJECT_OVERVIEW_CSV}`);

  // CSVファイル読み込み
  const csvContent = readFileSync(PROJECT_OVERVIEW_CSV, 'utf-8');
  const rows = parseCSV(csvContent);

  if (rows.length === 0) {
    throw new Error('CSVデータが空です');
  }

  console.log(`総行数: ${rows.length}（ヘッダー含む）`);

  // ヘッダーをスキップ
  const dataRows = rows.slice(1);
  console.log(`事業データ行数: ${dataRows.length}`);

  // 事業詳細データのマップを構築
  const projectDetails: ProjectDetailsData = {};
  let processedCount = 0;
  let skippedCount = 0;

  for (const row of dataRows) {
    // 予算事業IDが空の行はスキップ
    if (!row[COL.PROJECT_ID] || row[COL.PROJECT_ID].trim() === '') {
      skippedCount++;
      continue;
    }

    const projectId = parseInt(row[COL.PROJECT_ID], 10);

    if (isNaN(projectId)) {
      console.warn(`無効な予算事業ID: ${row[COL.PROJECT_ID]} (行スキップ)`);
      skippedCount++;
      continue;
    }

    const detail: ProjectDetail = {
      projectId,
      projectName: normalizeString(row[COL.PROJECT_NAME]),
      ministry: normalizeString(row[COL.MINISTRY]),
      bureau: normalizeString(row[COL.BUREAU]),
      purpose: normalizeString(row[COL.PURPOSE]),
      currentIssues: normalizeString(row[COL.CURRENT_ISSUES]),
      overview: normalizeString(row[COL.OVERVIEW]),
      url: parseURL(row[COL.URL]),
      category: normalizeString(row[COL.CATEGORY]),
      startYear: parseYear(row[COL.START_YEAR]),
      startYearUnknown: parseBoolean(row[COL.START_YEAR_UNKNOWN]),
      endYear: parseYear(row[COL.END_YEAR]),
      noEndDate: parseBoolean(row[COL.NO_END_DATE]),
      majorExpense: normalizeString(row[COL.MAJOR_EXPENSE]),
      remarks: normalizeString(row[COL.REMARKS]),
      implementationMethods: parseImplementationMethods(row),
      oldProjectNumber: normalizeString(row[COL.OLD_PROJECT_NUM]),
    };

    // projectIdを文字列キーとして保存
    projectDetails[projectId.toString()] = detail;
    processedCount++;
  }

  console.log(`処理完了: ${processedCount}件の事業詳細データを生成`);
  console.log(`スキップ: ${skippedCount}件`);

  // 出力ディレクトリを作成（存在しない場合）
  const outputDir = join('public', 'data');
  mkdirSync(outputDir, { recursive: true });

  // JSON出力
  const jsonString = JSON.stringify(projectDetails, null, 2);
  writeFileSync(OUTPUT_JSON, jsonString, 'utf-8');

  const fileSizeMB = (Buffer.byteLength(jsonString, 'utf-8') / 1024 / 1024).toFixed(2);
  console.log(`出力完了: ${OUTPUT_JSON}`);
  console.log(`ファイルサイズ: ${fileSizeMB}MB`);

  // 統計情報
  const withURL = Object.values(projectDetails).filter(p => p.url !== null).length;
  const withoutURL = processedCount - withURL;
  const urlRate = ((withURL / processedCount) * 100).toFixed(1);

  console.log('\n統計情報:');
  console.log(`  URL有り: ${withURL}件 (${urlRate}%)`);
  console.log(`  URL無し: ${withoutURL}件`);

  // 実施方法の統計
  const methodCounts: Record<string, number> = {
    '直接実施': 0,
    '補助': 0,
    '負担': 0,
    '交付': 0,
    '分担金・拠出金': 0,
    'その他': 0,
  };

  Object.values(projectDetails).forEach(p => {
    p.implementationMethods.forEach(method => {
      methodCounts[method]++;
    });
  });

  console.log('\n実施方法の内訳:');
  Object.entries(methodCounts).forEach(([method, count]) => {
    console.log(`  ${method}: ${count}件`);
  });

  console.log('\n✅ 事業詳細データ生成完了');
}

// スクリプト実行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }
}
