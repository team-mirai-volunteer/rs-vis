/**
 * データ JSON のサーバ側読み込みヘルパ。
 *
 * 探索順: public/data の raw → public/data の .gz → data/server の raw → data/server の .gz
 *
 * - ローカル/ビルド環境では public/data（prebuild 展開済み raw、または Git 管理の .gz）を読む。
 * - Vercel の関数バンドルには public/data を一切同梱せず（生 .json は展開後 96MB 級があり
 *   関数上限 250MB を超えるため）、prebuild が data/server/ に同期した .gz だけを同梱する
 *   （next.config.ts の outputFileTracingExcludes/Includes、scripts/decompress-data.sh 参照）。
 *   Next の実装上、excludes は includes 適用後の結合結果に掛かるため、除外ツリー
 *   （public/data）内のファイルを include で残すことはできない。別ツリーが必須。
 *
 * パス構築は本ヘルパで一元化し、各ローダにファイルパスを書かない
 * （ファイルトレーシングの推測同梱を発生させないため）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

/** raw 優先・.gz フォールバックで読む。どちらの置き場にも無ければ null */
export function tryReadDataJson<T>(fileName: string): T | null {
  // パストラバーサル防止（現状の呼び出し元は固定ファイル名だが、ユーティリティとして防御）
  if (path.basename(fileName) !== fileName) {
    throw new Error(`Invalid fileName: directory traversal is not allowed (${fileName})`);
  }
  // path.join の引数は文字列リテラルで書くこと（配列スプレッド等で組み立てると
  // ファイルトレーシングがパスを解析できず「プロジェクトルート全体」を依存とみなし、
  // .git や data/ 配下の GB 級ファイルまで関数に同梱される。実測 383MB 超過の事故あり）。
  const candidates = [
    path.join(process.cwd(), 'public', 'data', fileName),
    path.join(process.cwd(), 'data', 'server', fileName),
  ];
  for (const base of candidates) {
    if (fs.existsSync(base)) {
      return JSON.parse(fs.readFileSync(base, 'utf-8')) as T;
    }
    if (fs.existsSync(`${base}.gz`)) {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.gz`)).toString('utf-8')) as T;
    }
  }
  return null;
}

/** tryReadDataJson の必須版。見つからなければ再生成手順のヒント付きでエラー */
export function readDataJson<T>(fileName: string, regenerateHint: string): T {
  const data = tryReadDataJson<T>(fileName);
  if (data === null) {
    throw new Error(`${fileName}(.gz) が見つかりません。${regenerateHint}`);
  }
  return data;
}
