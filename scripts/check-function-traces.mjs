#!/usr/bin/env node
/**
 * サーバ関数バンドルのデータ同梱検査（Vercel 関数上限 250MB の再燃防止）。
 *
 * npm run build 後に .next/server 配下のファイルトレース結果（*.nft.json）を走査し、
 * 各関数の同梱ファイルを全件分類・サイズ集計して検査する:
 *   1. public/data の同梱は一切禁止（生 .json は展開後 96MB 級があり 250MB 超過が再発する）
 *   2. data/server は .gz と mof-budget-overview（.gz を持たない ~4KB）のみ許可
 *   3. data/server 以外の data/・.git・ルート直下の生成物ディレクトリの同梱は禁止
 *      （パス構築が静的解析できないとトレーサーが「プロジェクトルート全体」を依存に
 *      するため。houjin.db 1GB 等が同梱され実測 383MB 超過の事故あり — 必ず全件分類で検査）
 *   4. 関数あたりの合計トレースサイズが上限を超えたら失敗（既定 200MB。閾値は目安 —
 *      Vercel の計測と厳密一致はしないが、余裕を持って検知する）
 *   5. includes（next.config.ts）が反映されず data/server 同梱が 0 件なら構成破綻として失敗
 * 設計ルール R1〜R4: docs/data-pipeline-guide.md「サーバ関数バンドル 250MB 制約」（経緯は PR #259）
 *
 * 使い方: npm run build && npm run check-traces
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, '.next', 'server');
const SIZE_LIMIT_MB = 200;
// data/server 内で生 .json のまま同梱を許可するファイル（.gz を持たない小容量ファイル）
const ALLOWED_RAW = new Set(['mof-budget-overview-2023.json']);

if (!fs.existsSync(SERVER_DIR)) {
  console.error('❌ .next/server がありません。先に npm run build を実行してください。');
  process.exit(1);
}

/** SERVER_DIR 以下の *.nft.json を再帰列挙 */
function collectNftFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectNftFiles(p));
    else if (entry.name.endsWith('.nft.json')) out.push(p);
  }
  return out;
}

/** ルート相対パスを分類する */
function classify(rel) {
  if (rel.startsWith(`public${path.sep}data${path.sep}`)) return 'public/data';
  if (rel.startsWith(`data${path.sep}server${path.sep}`)) return 'data/server';
  // dev 専用の利用ログ（usage-log.ts）。next.config.ts の excludes で同梱除外済みのため
  // トレースに現れたら構成の破れとして禁止扱いにする
  if (rel.startsWith(`data${path.sep}usage${path.sep}`)) return 'data/usage';
  if (rel.startsWith(`data${path.sep}`)) return 'data/(server以外)';
  if (rel.startsWith(`.git${path.sep}`)) return '.git';
  if (rel.startsWith(`node_modules${path.sep}`)) return 'node_modules';
  if (rel.startsWith(`.next${path.sep}`)) return '.next';
  if (rel.startsWith('..')) return 'プロジェクト外';
  return 'その他';
}

const FORBIDDEN = new Set(['public/data', 'data/usage', 'data/(server以外)', '.git']);

let violations = 0;
let functionsWithBundleData = 0;

for (const nftPath of collectNftFiles(SERVER_DIR)) {
  const { files = [] } = JSON.parse(fs.readFileSync(nftPath, 'utf-8'));
  const nftDir = path.dirname(nftPath);
  const fnName = path.relative(SERVER_DIR, nftPath).replace(/\.nft\.json$/, '');

  let totalBytes = 0;
  const byCategory = new Map();
  const problems = [];
  let serverDataCount = 0;

  for (const f of files) {
    const abs = path.resolve(nftDir, f);
    const rel = path.relative(ROOT, abs);
    const cat = classify(rel);
    let size = 0;
    try {
      size = fs.statSync(abs).size;
    } catch {
      // トレースに載っていても実在しないファイルはサイズ0扱い
    }
    totalBytes += size;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + size);

    if (FORBIDDEN.has(cat)) {
      problems.push(`禁止パス（${cat}）: ${rel}`);
    } else if (cat === 'data/server') {
      serverDataCount++;
      if (!rel.endsWith('.json.gz') && !ALLOWED_RAW.has(path.basename(rel))) {
        problems.push(`許可外の生 .json: ${rel}`);
      }
    }
  }

  // includes は '*'（全関数対象）なので、どの関数も data/server を同梱していなければ構成の破れ
  if (serverDataCount === 0) {
    problems.push('data/server の同梱が 0 件です（outputFileTracingIncludes 未反映の疑い）');
  } else {
    functionsWithBundleData++;
  }
  const totalMb = totalBytes / 1e6;
  if (totalMb > SIZE_LIMIT_MB) {
    problems.push(`合計トレースサイズ ${totalMb.toFixed(1)}MB > 上限目安 ${SIZE_LIMIT_MB}MB`);
  }

  const summary = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / 1e6).toFixed(1)}MB`)
    .join(', ');
  console.log(`📦 ${fnName}: 合計 ${totalMb.toFixed(1)}MB (${summary})`);
  for (const p of problems) {
    console.log(`   ❌ ${p}`);
    violations++;
  }
}

if (functionsWithBundleData === 0) {
  console.error(
    '❌ data/server を同梱する関数が 0 件です。outputFileTracingIncludes が反映されていません。' +
    'next.config.ts と scripts/decompress-data.sh（prebuild の同期）を確認してください。'
  );
  process.exit(1);
}
if (violations > 0) {
  console.error(
    `\n❌ 違反 ${violations}件。next.config.ts の outputFileTracingExcludes/Includes と ` +
    'ローダの読み込みパス（app/lib/api/data-file.ts のリテラル規約）を確認してください。'
  );
  process.exit(1);
}
console.log(
  `\n✅ 検査完了: data/server 同梱の関数 ${functionsWithBundleData}件、違反なし`
);
