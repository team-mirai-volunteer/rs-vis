#!/usr/bin/env npx tsx
/**
 * 事項別内訳データの検証スクリプト
 *
 * `public/data/mof-jikou-{YEAR}.json` の帳票別合計を、同じ帳票の配布 CSV
 * （`data/download/mof_{YEAR}/DL{帳票ID}.zip` 内の `b.csv`）と突き合わせる。
 * Web 帳票のスクレイピングは列位置の取り違えで静かに壊れるため、
 * 生成のたびにこの検証を通すこと。
 *
 * 使用法:
 *   tsx scripts/validate-mof-jikou-data.ts [FISCAL_YEAR...]
 *   デフォルト: public/data にある mof-jikou-*.json の全年度
 *
 * 突き合わせの対応は docs/data-pipeline-guide.md 2-8節を参照。
 */

import * as fs from 'fs';
import * as path from 'path';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';
import { MOF_REVISION_NUMBERS, type MOFJikouData, type MOFJikouItem } from '@/types/mof-jikou';

/** 帳票ごとに「JSONのどの値」と「CSVのどの列」を突き合わせるか */
interface Check {
  /** JSON 側の集計対象。null を含む項目は無視する */
  field: 'amount' | 'currentAmount' | 'spent' | 'carriedOver' | 'unused' | 'difference';
  /** CSV の列名。文字列なら前方一致、正規表現ならその一致で探す（年度が名前に入る列があるため） */
  column: string | RegExp;
  /** CSV の値を円に直す倍率 */
  scale: number;
}

/**
 * 本年度額の列。見出しに元号年が入る（例: 令和8年度要求額(千円)／平成29年度予定額(千円)）。
 * 平成年度の帳票と令和元年度（「令和元年度」表記）も拾えるよう元号と「元」を許容する。
 */
const ERA_AMOUNT_COLUMN = /^(令和|平成)(元|\d+)年度/;

/** 帳票IDの末尾5桁 → 検証内容 */
const CHECKS: Record<string, Check[]> = {
  '11001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  '12001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  '13001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  '31001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  '32001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  '33001': [{ field: 'amount', column: ERA_AMOUNT_COLUMN, scale: 1000 }],
  // 補正は号数ぶん（21001〜21004 / 22001〜22004）を同じ内容で検証する。CHECKS の初期化で展開する。
  '77001': [
    { field: 'amount', column: '歳出予算額(円)', scale: 1 },
    { field: 'currentAmount', column: '歳出予算現額(円)', scale: 1 },
    { field: 'spent', column: '支出済歳出額(円)', scale: 1 },
    { field: 'carriedOver', column: '翌年度繰越額(円)', scale: 1 },
    { field: 'unused', column: '不用額(円)', scale: 1 },
  ],
};

// 補正予算は事項別内訳に補正対象の事項しか載らないため、改予算額の合計は一致しない。
// 増減（差引額）だけが全事項ぶんそろう。差引額の列名は会計で違う（一般会計は「補正要求」、
// 特別会計は「補正予定」）。号数ぶん（第1号〜第4号）を同じ内容で検証する。
for (const revision of MOF_REVISION_NUMBERS) {
  const seq = String(revision).padStart(3, '0');
  CHECKS[`21${seq}`] = [{ field: 'difference', column: '補正要求差引額', scale: 1000 }];
  CHECKS[`22${seq}`] = [{ field: 'difference', column: '補正予定差引額', scale: 1000 }];
}

/** CSV を行の配列にする（値にカンマを含まない単純な配布物なので分割で足りる） */
function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/**
 * 歳出側の CSV を読む。
 *
 * 通常は `b.csv` だが a/b が入れ替わっている帳票があるので中身で判定する
 * （docs/mof-budget-data-guide.md 2-5節）。エントリ構成も帳票により違うため、
 * 決め打ちで開かず ZIP に実在する CSV を順に見る。
 */
function readExpenditureCsv(zipPath: string, documentId: string): Array<Record<string, string>> {
  const entries = listZipEntries(zipPath).filter(e => e.toLowerCase().endsWith('.csv'));
  // b → a の順に見たいので、b で終わるものを先に
  const ordered = [
    ...entries.filter(e => e.includes(`${documentId}b.`)),
    ...entries.filter(e => !e.includes(`${documentId}b.`)),
  ];
  for (const entry of ordered) {
    const rows = parseCsv(readZipEntryText(zipPath, entry));
    const headers = Object.keys(rows[0] ?? {});
    // 歳出側は主要経費別分類コードか使途別分類コードを持つ
    if (headers.some(h => h.includes('主要経費別分類') || h.includes('使途別分類'))) return rows;
  }
  throw new Error(
    `歳出側のCSVが見つかりません: ${zipPath}（収録: ${entries.join(', ') || 'なし'}）`
  );
}

function sumColumn(
  rows: Array<Record<string, string>>,
  column: string | RegExp,
  scale: number
): number {
  const match = (h: string) => (typeof column === 'string' ? h.startsWith(column) : column.test(h));
  const header = Object.keys(rows[0] ?? {}).find(match);
  if (!header) throw new Error(`列が見つかりません: ${column}`);
  return rows.reduce((sum, r) => sum + (parseInt(r[header] || '0', 10) || 0), 0) * scale;
}

function sumField(items: MOFJikouItem[], field: Check['field']): number {
  return items.reduce((sum, i) => sum + (i[field] ?? 0), 0);
}

function validateYear(year: number): { ok: boolean; checked: number } {
  const jsonPath = path.join(process.cwd(), 'public', 'data', `mof-jikou-${year}.json`);
  const data: MOFJikouData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const downloadDir = path.join(process.cwd(), 'data', 'download', `mof_${year}`);

  console.log(`\n=== ${data.metadata.eraLabel}（${year}）事項 ${data.summary.count} 件 ===`);
  let ok = true;
  let checked = 0;

  const byDocument = new Map<string, MOFJikouItem[]>();
  for (const item of data.items) {
    const list = byDocument.get(item.documentId);
    if (list) list.push(item);
    else byDocument.set(item.documentId, [item]);
  }

  for (const [documentId, items] of [...byDocument].sort()) {
    const checks = CHECKS[documentId.slice(4)];
    if (!checks) {
      console.log(`  ${documentId}: 検証対象外`);
      continue;
    }
    const zipPath = path.join(downloadDir, `DL${documentId}.zip`);
    if (!fs.existsSync(zipPath)) {
      console.log(`  ${documentId}: CSV未取得のためスキップ（${path.basename(zipPath)}）`);
      continue;
    }
    const rows = readExpenditureCsv(zipPath, documentId);
    for (const check of checks) {
      const actual = sumField(items, check.field);
      const expected = sumColumn(rows, check.column, check.scale);
      const match = actual === expected;
      if (!match) ok = false;
      checked += 1;
      console.log(
        `  ${match ? 'OK ' : 'NG '} ${documentId} ${check.field.padEnd(13)} ` +
          `JSON ${actual.toLocaleString().padStart(22)} / CSV ${expected.toLocaleString().padStart(22)}`
      );
    }
  }

  const duplicates = data.items.length - new Set(data.items.map(i => i.key)).size;
  if (duplicates > 0) {
    ok = false;
    console.log(`  NG  合成キーの重複 ${duplicates} 件`);
  }
  return { ok, checked };
}

function main() {
  const args = process.argv.slice(2).map(v => parseInt(v, 10));
  if (args.some(y => isNaN(y) || y < 2000 || y > 2100)) {
    console.error(`Invalid fiscal year: ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  const years = args.length
    ? args
    : fs
        .readdirSync(path.join(process.cwd(), 'public', 'data'))
        .map(f => f.match(/^mof-jikou-(\d{4})\.json$/)?.[1])
        .filter((v): v is string => Boolean(v))
        .map(Number)
        .sort();

  if (years.length === 0) {
    console.error('検証対象がありません。npm run generate-mof-jikou を実行してください。');
    process.exit(1);
  }

  let ok = true;
  let checked = 0;
  for (const year of years) {
    const r = validateYear(year);
    ok = ok && r.ok;
    checked += r.checked;
  }
  console.log(`\n${ok ? '✅ 全一致' : '❌ 不一致あり'}（${checked} 項目を検証）`);
  if (!ok) process.exit(1);
}

main();
