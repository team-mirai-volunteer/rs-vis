/**
 * `data/download/digital_agency_budget_2024/`配下のPDF・Excelを、ローカルで
 * （APIトークンを消費せず）テキスト化する。PDFは`pdf-parse`、Excelは既存の
 * `zip-reader.ts`でxlsx内部のXML（sharedStrings・worksheet）を直接パースする
 * （xlsxはzip形式のXMLなので専用ライブラリ不要）。
 *
 * 出力は元ファイルと同じディレクトリに同名`.txt`で保存する
 * （例: `03_kamokubetsu_meisaisho_r6.pdf` → `03_kamokubetsu_meisaisho_r6.txt`）。
 *
 * 実行: npx tsx scripts/extract-digital-agency-budget-text.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import { listZipEntries, readZipEntryText } from '@/scripts/zip-reader';

const DIR = path.join(process.cwd(), 'data', 'download', 'digital_agency_budget_2024');

/**
 * PDFの出力は`.local.txt`（pdf-parseによるローカルのテキストレイヤー抽出）とする。
 * 一部（各目明細書系）はフォントにToUnicode CMapが無く漢字が復元できないため、
 * Claude ReadツールでのマルチモーダルPDF読み取り結果を`.web.txt`として別途用意し、
 * 比較できるようにしている（docs/tasks/20260907_1829_PDF文字化けとローカルテキスト化の比較.md 参照）。
 * xlsxは元々zip内XMLの直接パースのみでWeb/ローカルの差が無いため`.txt`のまま。
 */

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

/** xlsxはzip形式のXMLなので、sharedStrings.xml・worksheets/sheetN.xmlを直接パースする */
function extractXlsxText(filePath: string): string {
  const entries = listZipEntries(filePath).filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e));
  const sharedXml = readZipEntryText(filePath, 'xl/sharedStrings.xml');
  const shared: string[] = [];
  const stringRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let sm: RegExpExecArray | null;
  while ((sm = stringRe.exec(sharedXml))) {
    shared.push(sm[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  }

  const sheets: string[] = [];
  for (const entry of entries.sort()) {
    const sheetXml = readZipEntryText(filePath, entry);
    const rows: string[] = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(sheetXml))) {
      const cells: string[] = [];
      // セルは列位置を持つ属性順不定のためtype(t)属性の有無だけ緩く拾う
      const cellRe = /<c\b[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>|<c\b[^>]*\/>/g;
      const typeRe = /t="(\w+)"/;
      const fullCellRe = /<c\b([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>|<c\b([^>]*)\/>/g;
      let cm: RegExpExecArray | null;
      while ((cm = fullCellRe.exec(rm[1]))) {
        const attrs = cm[1] ?? cm[3] ?? '';
        const val = cm[2];
        if (val === undefined) {
          cells.push('');
          continue;
        }
        const typeMatch = typeRe.exec(attrs);
        cells.push(typeMatch?.[1] === 's' ? (shared[Number(val)] ?? '') : val);
      }
      rows.push(cells.join('\t'));
    }
    sheets.push(rows.join('\n'));
  }
  return sheets.join('\n\n---\n\n');
}

async function main() {
  const files = fs.readdirSync(DIR).filter(f => /\.(pdf|xlsx)$/.test(f));
  for (const file of files) {
    const filePath = path.join(DIR, file);
    const outPath = file.endsWith('.pdf') ? filePath.replace(/\.pdf$/, '.local.txt') : filePath.replace(/\.xlsx$/, '.txt');
    try {
      const text = file.endsWith('.pdf') ? await extractPdfText(filePath) : extractXlsxText(filePath);
      fs.writeFileSync(outPath, text, 'utf-8');
      console.log(`OK   ${file} -> ${path.basename(outPath)} (${text.length}文字)`);
    } catch (e) {
      console.log(`FAIL ${file}: ${(e as Error).message}`);
    }
  }
}

main();
