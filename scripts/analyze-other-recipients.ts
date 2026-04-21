/**
 * 「その他」支出先の関係性分析
 *
 * 調査内容:
 *   1. その他の契約 × その他支出先 の関係性
 *   2. その他支出先=TRUE かつ 具体的な会社名（支出先名≠「その他」）かつ 法人番号なし の行が、
 *      同じ事業ID+ブロック番号内の「その他」行と持つ関係性
 *
 * 入力: data/result/recipients_with_total.csv, recipients_without_total.csv
 * 出力: data/result/other_analysis_*.txt
 *
 * 使い方:
 *   npx tsx scripts/analyze-other-recipients.ts [output-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { readShiftJISCSV, parseAmount } from './csv-reader';
import type { CSVRow } from '@/types/rs-system';

const DEFAULT_OUTPUT_DIR = path.join(__dirname, '../data/result');

function main() {
  const outputDir = process.argv[2] ?? DEFAULT_OUTPUT_DIR;

  const withTotalPath = path.join(__dirname, '../data/result/recipients_with_total.csv');
  const withoutTotalPath = path.join(__dirname, '../data/result/recipients_without_total.csv');

  console.log('読み込み中...');
  const rows: CSVRow[] = [
    ...readShiftJISCSV(withTotalPath),
    ...readShiftJISCSV(withoutTotalPath),
  ];
  console.log(`総行数: ${rows.length.toLocaleString()} 行`);

  // ========================================
  // 1. その他の契約 × その他支出先 クロス集計
  // ========================================
  const cross: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const c = r['その他の契約']?.trim() || '(空)';
    const f = r['その他支出先']?.trim() || '(空)';
    if (!cross[c]) cross[c] = {};
    cross[c][f] = (cross[c][f] ?? 0) + 1;
  }

  const crossLines: string[] = [
    '=== 1. その他の契約 × その他支出先 クロス集計 ===',
    '',
    'その他の契約  | その他支出先  | 行数',
    '-------------|--------------|------',
  ];
  let totalRows = 0;
  for (const [c, flags] of Object.entries(cross).sort()) {
    for (const [f, cnt] of Object.entries(flags).sort()) {
      crossLines.push(`${c.padEnd(12)} | ${f.padEnd(12)} | ${cnt.toLocaleString()}`);
      totalRows += cnt;
    }
  }
  crossLines.push('');
  crossLines.push(`合計: ${totalRows.toLocaleString()} 行`);
  crossLines.push('');
  crossLines.push('【補足】');
  const truTrue = cross['TRUE']?.['TRUE'] ?? 0;
  const trueTotal = Object.values(cross['TRUE'] ?? {}).reduce((a, b) => a + b, 0);
  const flagTrue = Object.values(cross).reduce((s, f) => s + (f['TRUE'] ?? 0), 0);
  crossLines.push(`その他の契約=TRUE かつ その他支出先=TRUE: ${truTrue.toLocaleString()} 行`);
  crossLines.push(`その他の契約=TRUE の合計: ${trueTotal.toLocaleString()} 行`);
  crossLines.push(`その他支出先=TRUE の合計: ${flagTrue.toLocaleString()} 行`);
  crossLines.push('→ 2つのフラグは独立しており完全一致しない（それぞれ別の視点の分類）');

  // ========================================
  // 2. その他支出先=TRUE かつ 具体的な会社名 かつ CN なし → 同ブロックの「その他」行との関係
  // ========================================

  // (a) 全行をブロックキーで索引
  // key: `${事業ID}_${ブロック番号}`
  const blockIndex = new Map<string, CSVRow[]>();
  for (const r of rows) {
    const pid = r['予算事業ID']?.trim();
    const bno = r['支出先ブロック番号']?.trim();
    if (!pid || !bno) continue;
    const key = `${pid}_${bno}`;
    if (!blockIndex.has(key)) blockIndex.set(key, []);
    (blockIndex.get(key) as CSVRow[]).push(r);
  }

  // (b) 対象行: その他支出先=TRUE かつ 支出先名 != 'その他' かつ CN なし
  const targetRows = rows.filter(r =>
    r['その他支出先']?.trim() === 'TRUE' &&
    r['支出先名']?.trim() !== 'その他' &&
    !r['法人番号']?.trim()
  );

  // (c) 同ブロック内の「その他」行との照合
  interface MatchResult {
    pid: string;
    bno: string;
    targetName: string;
    targetAmount: number;
    otherContractFlag: string;
    otherRows: { name: string; amount: number; cn: string }[];
    otherTotalAmount: number;
  }

  const matches: MatchResult[] = [];
  const noMatchKeys = new Set<string>();

  for (const r of targetRows) {
    const pid = r['予算事業ID']?.trim() ?? '';
    const bno = r['支出先ブロック番号']?.trim() ?? '';
    const key = `${pid}_${bno}`;
    const blockRows = blockIndex.get(key) ?? [];

    const otherRows = blockRows.filter(br =>
      br['支出先名']?.trim() === 'その他' &&
      br !== r
    );

    if (otherRows.length === 0) {
      noMatchKeys.add(key);
      continue;
    }

    matches.push({
      pid,
      bno,
      targetName: r['支出先名']?.trim() ?? '',
      targetAmount: parseAmount(r['金額'] ?? ''),
      otherContractFlag: r['その他の契約']?.trim() ?? '',
      otherRows: otherRows.map(or => ({
        name: or['支出先名']?.trim() ?? '',
        amount: parseAmount(or['金額'] ?? ''),
        cn: or['法人番号']?.trim() ?? '',
      })),
      otherTotalAmount: otherRows.reduce((s, or) => s + parseAmount(or['金額'] ?? ''), 0),
    });
  }

  // 集計
  const matchLines: string[] = [
    '',
    '=== 2. その他支出先=TRUE（具体的な社名・CN なし）と同ブロック「その他」行の関係 ===',
    '',
    `対象行数（その他支出先=TRUE、社名あり、CNなし）: ${targetRows.length.toLocaleString()} 行`,
    `  同ブロックに「その他」行が存在: ${matches.length.toLocaleString()} 行`,
    `  同ブロックに「その他」行が不在: ${noMatchKeys.size.toLocaleString()} ブロック`,
    '',
  ];

  // その他の契約フラグ×マッチ状況
  const matchOtherContract: Record<string, number> = {};
  for (const m of matches) {
    const key = m.otherContractFlag || '(空)';
    matchOtherContract[key] = (matchOtherContract[key] ?? 0) + 1;
  }
  matchLines.push('  マッチした行の その他の契約 フラグ内訳:');
  for (const [k, v] of Object.entries(matchOtherContract).sort()) {
    matchLines.push(`    その他の契約=${k}: ${v.toLocaleString()} 行`);
  }

  // 例示（先頭20件）
  matchLines.push('');
  matchLines.push('--- 具体例（先頭20件） ---');
  matchLines.push('事業ID  ブロック  対象支出先名                   対象金額(円)   同ブロックその他金額(円)  その他の契約');
  matchLines.push('--------|--------|------------------------------|------------|----------------------|------------');
  for (const m of matches.slice(0, 20)) {
    const targetAmt = m.targetAmount.toLocaleString().padStart(12);
    const otherAmt = m.otherTotalAmount.toLocaleString().padStart(22);
    const name = m.targetName.slice(0, 28).padEnd(28);
    matchLines.push(`${m.pid.padEnd(8)} ${m.bno.padEnd(8)} ${name} ${targetAmt}  ${otherAmt}  ${m.otherContractFlag}`);
    for (const or of m.otherRows.slice(0, 2)) {
      matchLines.push(`                └その他行: 金額=${or.amount.toLocaleString()} CN=${or.cn || '(なし)'}`);
    }
  }

  // 金額の一致パターン調査（対象行の金額 と その他行の金額が一致するケース）
  let exactMatch = 0;
  let partialMatch = 0;
  let noAmountMatch = 0;
  for (const m of matches) {
    if (m.otherRows.some(or => or.amount === m.targetAmount && m.targetAmount > 0)) {
      exactMatch++;
    } else if (m.targetAmount > 0 && m.otherTotalAmount > 0) {
      partialMatch++;
    } else {
      noAmountMatch++;
    }
  }
  matchLines.push('');
  matchLines.push('--- 金額一致パターン ---');
  matchLines.push(`  対象行金額 = その他行金額（完全一致）: ${exactMatch.toLocaleString()} 件`);
  matchLines.push(`  金額あり・不一致               : ${partialMatch.toLocaleString()} 件`);
  matchLines.push(`  どちらかの金額が0              : ${noAmountMatch.toLocaleString()} 件`);

  // 出力
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'other_analysis.txt');
  fs.writeFileSync(outputPath, [...crossLines, ...matchLines].join('\n'), 'utf-8');

  // コンソール
  for (const line of crossLines) console.log(line);
  for (const line of matchLines) console.log(line);
  console.log('');
  console.log(`→ ${outputPath}`);
}

main();
