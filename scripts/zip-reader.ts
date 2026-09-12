/**
 * ZIP アーカイブから1エントリを取り出す最小実装。
 *
 * 財務省の予算書 CSV は ZIP で配布される。展開したファイルを併存させると
 * 同じ内容が二重に残るため、パイプラインは ZIP から直接読む。
 * Node に ZIP の標準APIが無く、この用途のためだけに依存を増やしたくないので、
 * 必要な範囲（無圧縮 / deflate）だけを自前で読む。
 *
 * 対応しないもの: 暗号化、ZIP64、マルチボリューム、deflate 以外の圧縮方式。
 * 予算書の配布物はいずれも該当しないため、遭遇したらエラーにする。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/** End of Central Directory シグネチャ */
const EOCD_SIGNATURE = 0x06054b50;
/** Central Directory File Header シグネチャ */
const CENTRAL_SIGNATURE = 0x02014b50;

interface CentralEntry {
  fileName: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/** End of Central Directory を末尾から探す（コメント付きでも見つかるよう後ろから走査） */
function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD は22バイト＋コメント(最大65535)。末尾から順に signature を探す
  const minOffset = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('ZIP の End of Central Directory が見つかりません');
}

/** セントラルディレクトリを読んでエントリ一覧を返す */
function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`ZIP のセントラルディレクトリが壊れています (entry ${i})`);
    }
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    entries.push({
      compressionMethod: buf.readUInt16LE(offset + 10),
      compressedSize: buf.readUInt32LE(offset + 20),
      fileName: buf.toString('utf-8', offset + 46, offset + 46 + nameLength),
      localHeaderOffset: buf.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** エントリの中身を取り出す */
function extract(buf: Buffer, entry: CentralEntry): Buffer {
  // ローカルヘッダのファイル名長・拡張フィールド長はセントラル側と異なりうるので読み直す
  const local = entry.localHeaderOffset;
  const nameLength = buf.readUInt16LE(local + 26);
  const extraLength = buf.readUInt16LE(local + 28);
  const start = local + 30 + nameLength + extraLength;
  const body = buf.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) return Buffer.from(body); // 無圧縮
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(body); // deflate
  throw new Error(
    `未対応の圧縮方式です (method=${entry.compressionMethod}, entry=${entry.fileName})`
  );
}

/** ZIP 内のエントリ名を列挙する */
export function listZipEntries(zipPath: string): string[] {
  const buf = fs.readFileSync(zipPath);
  return readCentralDirectory(buf).map(e => e.fileName);
}

/**
 * ZIP から1エントリを取り出す。
 *
 * @param zipPath ZIP ファイルのパス
 * @param entryName エントリ名。ディレクトリを含む場合も basename で照合する
 */
export function readZipEntry(zipPath: string, entryName: string): Buffer {
  const buf = fs.readFileSync(zipPath);
  const entries = readCentralDirectory(buf);
  // 配布物によってはエントリ名にディレクトリが付く。basename で拾う
  const entry =
    entries.find(e => e.fileName === entryName) ??
    entries.find(e => path.basename(e.fileName) === entryName);
  if (!entry) {
    throw new Error(
      `ZIP にエントリがありません: ${entryName} (${zipPath})\n` +
        `収録: ${entries.map(e => e.fileName).join(', ')}`
    );
  }
  return extract(buf, entry);
}

/** ZIP から1エントリをテキストとして取り出す */
export function readZipEntryText(
  zipPath: string,
  entryName: string,
  encoding: BufferEncoding = 'utf-8'
): string {
  return readZipEntry(zipPath, entryName).toString(encoding);
}
