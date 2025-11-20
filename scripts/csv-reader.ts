/**
 * CSV読み込みユーティリティ
 * 正規化済みCSV（UTF-8）専用
 */

import * as fs from 'fs';
import type { CSVRow } from '@/types/rs-system';

/**
 * CSVファイルを読み込む（UTF-8）
 * @param filePath CSVファイルのパス
 * @returns パースされたCSV行の配列
 */
export function readShiftJISCSV(filePath: string): CSVRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseCSV(content);
}

/**
 * CSV文字列をパースしてオブジェクト配列に変換
 * @param content CSV文字列
 * @returns パースされたオブジェクト配列
 */
function parseCSV(content: string): CSVRow[] {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  // ヘッダー行を取得
  const headers = parseLine(lines[0]);

  // データ行をパース
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      continue; // 空行をスキップ
    }

    const values = parseLine(line);
    if (values.length !== headers.length) {
      console.warn(`Line ${i + 1}: カラム数が一致しません (期待: ${headers.length}, 実際: ${values.length})`);
      continue;
    }

    const row: CSVRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row);
  }

  return rows;
}

/**
 * CSV行を解析してフィールド配列に分割
 * ダブルクォート囲みのフィールドに対応
 * @param line CSV行
 * @returns フィールド配列
 */
function parseLine(line: string): string[] {
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
 * 金額文字列を数値に変換（カンマ除去対応）
 * @param amountStr 金額文字列（例: "1,234,567"）
 * @returns 数値（千円単位）
 */
export function parseAmount(amountStr: string): number {
  const cleaned = amountStr.replace(/,/g, '').trim();
  const value = Number(cleaned);
  return isNaN(value) ? 0 : value;
}
