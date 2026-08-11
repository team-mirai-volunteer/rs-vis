/**
 * 支出先逆引きインデックス生成スクリプト
 *
 * subcontracts-{YEAR}.json（generate-subcontracts.ts の成果物）から、
 * 法人番号（なければ正規化名）をキーとする逆引きインデックスを生成する。
 * パイプライン後段: generate-subcontracts → 本スクリプト の順で実行すること。
 *
 * 使用法:
 *   tsx scripts/generate-recipient-index.ts [YEAR]
 *   デフォルト: 2024
 *
 * 出力: public/data/recipient-index-{YEAR}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SubcontractIndex, SubcontractGraph, BlockNode } from '@/types/subcontract';
import type {
  RecipientIndex,
  RecipientEntry,
  RecipientAppearance,
  AppearanceDownstream,
} from '@/types/recipient-index';
import { buildRecipientKey, resolveRecipientKey, isExcludedRecipientName, isValidCorporateNumber } from '@/app/lib/recipient-key';
import type { RecipientResolution } from '@/app/lib/recipient-key';

const YEAR = parseInt(process.argv[2] || '2024', 10);
if (isNaN(YEAR) || YEAR < 2000 || YEAR > 2100) {
  console.error(`Invalid year: ${process.argv[2]}`);
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '../public/data');
const SOURCE_FILE = `subcontracts-${YEAR}.json`;
const OUTPUT_FILE = `recipient-index-${YEAR}.json`;

const sourcePath = path.join(DATA_DIR, SOURCE_FILE);
if (!fs.existsSync(sourcePath)) {
  console.error(`${SOURCE_FILE} がありません。先に generate-subcontracts を実行してください。`);
  process.exit(1);
}

console.log(`📖 Reading ${SOURCE_FILE}...`);
const index: SubcontractIndex = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));

// 法人番号解決マッピング（houjin.db裏取り。無ければ解決なしで続行）
const resolutionPath = path.join(DATA_DIR, `recipient-resolution-${YEAR}.json`);
let resolution: RecipientResolution | undefined;
if (fs.existsSync(resolutionPath)) {
  resolution = JSON.parse(fs.readFileSync(resolutionPath, 'utf-8'));
  console.log(`📖 解決マッピング適用: mergeCn ${Object.keys(resolution!.mergeCn).length}件 / supplement ${Object.keys(resolution!.supplement).length}件`);
} else {
  console.warn(`⚠️ ${path.basename(resolutionPath)} が無いため解決なしで生成（先に generate-recipient-resolution.py を推奨）`);
}

// キー互換: 解決で付け替わった旧キー → 現行キー
const redirects: Record<string, string> = {};
/** 解決済みキーを返しつつ、旧キーと異なれば redirects に記録する */
function keyOf(name: string, cn: string): string {
  const resolved = resolveRecipientKey(name, cn, resolution);
  const naive = buildRecipientKey(name, cn);
  if (naive !== resolved) redirects[naive] = resolved;
  return resolved;
}

// ─── 集計 ──────────────────────────────────────────────

const entries = new Map<string, RecipientEntry>();
// 表記ゆれの頻度（代表表記の決定用）: key → (表記 → 出現回数)
const nameFreq = new Map<string, Map<string, number>>();

let appearanceCount = 0;
let excludedCount = 0;
let sourceAmountSum = 0; // 検証用: 対象 recipients の amount 総和

function getEntry(key: string, name: string, _corporateNumber: string): RecipientEntry {
  let e = entries.get(key);
  if (!e) {
    e = {
      key,
      name,
      // 代表番号は解決後の正規キー由来（key が13桁cnならそれ、name:キーは空）。
      // 誤記載の生番号がエントリ代表にならないようにする（生番号は appearance 側に保持）。
      corporateNumber: /^\d{13}$/.test(key) ? key : '',
      aliases: [],
      totals: { directAmount: 0, directCount: 0, subcontractAmount: 0, subcontractCount: 0 },
      byMinistry: [],
      appearances: [],
    };
    entries.set(key, e);
    nameFreq.set(key, new Map());
  }
  const freq = nameFreq.get(key)!;
  freq.set(name, (freq.get(name) ?? 0) + 1);
  return e;
}

/** ブロックの支出先が1者ならそのキー（upstream の recipientKey 解決用） */
function soleRecipientKey(block: BlockNode): string | null {
  const usable = block.recipients.filter(r => !isExcludedRecipientName(r.name));
  if (usable.length !== 1) return null;
  return keyOf(usable[0].name, usable[0].corporateNumber);
}

for (const [pidStr, project] of Object.entries(index) as [string, SubcontractGraph][]) {
  const pid = parseInt(pidStr, 10);
  const blockById = new Map(project.blocks.map(b => [b.blockId, b]));

  // flows から上流・下流の隣接を引く（isReference は構造扱いしない）
  const upstreamOf = new Map<string, string>(); // targetBlockId → sourceBlockId
  const downstreamOf = new Map<string, string[]>(); // sourceBlockId → targetBlockIds
  for (const f of project.flows) {
    if (f.isReference) continue;
    if (f.sourceBlock != null) {
      // 合流（複数上流）は最初の1本を採用（targetIncomingBlockCount で検出可能）
      if (!upstreamOf.has(f.targetBlock)) upstreamOf.set(f.targetBlock, f.sourceBlock);
      const list = downstreamOf.get(f.sourceBlock) ?? [];
      list.push(f.targetBlock);
      downstreamOf.set(f.sourceBlock, list);
    }
  }

  for (const block of project.blocks) {
    // 下流情報（ブロック単位で共通）
    const downstream: AppearanceDownstream[] = (downstreamOf.get(block.blockId) ?? [])
      .map(id => blockById.get(id))
      .filter((b): b is BlockNode => b != null)
      .map(b => ({
        blockName: b.blockName,
        amount: b.totalAmount,
        recipientKeys: b.recipients
          .filter(r => !isExcludedRecipientName(r.name))
          .map(r => keyOf(r.name, r.corporateNumber)),
      }));

    // 上流情報
    const upstreamId = upstreamOf.get(block.blockId);
    const upstreamBlock = upstreamId != null ? blockById.get(upstreamId) : undefined;
    const upstream = upstreamBlock
      ? { blockName: upstreamBlock.blockName, recipientKey: soleRecipientKey(upstreamBlock) }
      : null;

    for (const r of block.recipients) {
      if (isExcludedRecipientName(r.name)) {
        excludedCount++;
        continue;
      }
      const key = keyOf(r.name, r.corporateNumber);
      const entry = getEntry(key, r.name, r.corporateNumber);

      // 解決でキーが付け替わった出現は、元データの生法人番号を保持（切り分け用）。
      // key が法人番号のとき: 生番号が異なれば保持。key が name: のとき: 生番号は無い（欠落）
      const rawCn = (r.corporateNumber || '').trim();
      const naiveKey = buildRecipientKey(r.name, r.corporateNumber);
      const appearance: RecipientAppearance = {
        pid,
        projectName: project.projectName,
        ministry: project.ministry,
        blockId: block.blockId,
        originKind: block.originKind,
        amount: r.amount,
        upstream,
        downstream,
        ...(naiveKey !== key ? { rawCorporateNumber: isValidCorporateNumber(rawCn) ? rawCn : '' } : {}),
      };
      entry.appearances.push(appearance);
      appearanceCount++;
      sourceAmountSum += r.amount;

      const isDirect = block.originKind === 'direct';
      if (isDirect) {
        entry.totals.directAmount += r.amount;
        entry.totals.directCount += 1;
      } else {
        entry.totals.subcontractAmount += r.amount;
        entry.totals.subcontractCount += 1;
      }
    }
  }
}

// ─── 後処理: 代表表記・aliases・府省庁別集計・ソート ──────────────

for (const [key, entry] of entries) {
  const freq = nameFreq.get(key)!;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  entry.name = sorted[0][0];
  entry.aliases = sorted.map(([n]) => n);

  // 府省庁別集計（Multi-block 対応: appearances から reduce）
  const byMinistry = new Map<string, { direct: number; sub: number; pids: Set<number> }>();
  for (const a of entry.appearances) {
    let m = byMinistry.get(a.ministry);
    if (!m) {
      m = { direct: 0, sub: 0, pids: new Set() };
      byMinistry.set(a.ministry, m);
    }
    if (a.originKind === 'direct') m.direct += a.amount;
    else m.sub += a.amount;
    m.pids.add(a.pid);
  }
  entry.byMinistry = [...byMinistry.entries()]
    .map(([ministry, m]) => ({
      ministry,
      directAmount: m.direct,
      subcontractAmount: m.sub,
      projectCount: m.pids.size,
    }))
    .sort((a, b) => (b.directAmount + b.subcontractAmount) - (a.directAmount + a.subcontractAmount));

  // 出現は金額降順
  entry.appearances.sort((a, b) => b.amount - a.amount);
}

// ─── 検証 ──────────────────────────────────────────────

// 内部整合: appearances の総和 = 取り込んだ recipients の総和（必須）
let indexedAmountSum = 0;
let indexedAppearances = 0;
for (const entry of entries.values()) {
  for (const a of entry.appearances) indexedAmountSum += a.amount;
  indexedAppearances += entry.appearances.length;
}
if (indexedAmountSum !== sourceAmountSum || indexedAppearances !== appearanceCount) {
  console.error(
    `❌ 整合性エラー: amount合計 ${indexedAmountSum} != ${sourceAmountSum} ` +
    `または appearances ${indexedAppearances} != ${appearanceCount}`
  );
  process.exit(1);
}

// 回帰チェック（2024年度の実測値。データ更新時に変動したら値を更新すること）
if (YEAR === 2024) {
  const ntt = entries.get('7010001064648');
  const expected = { directCount: 94, subcontractCount: 54 };
  if (!ntt) {
    console.warn('⚠️ 回帰チェック: NTTコミュニケーションズ(7010001064648)が見つかりません');
  } else if (
    ntt.totals.directCount !== expected.directCount ||
    ntt.totals.subcontractCount !== expected.subcontractCount
  ) {
    console.warn(
      `⚠️ 回帰チェック不一致: NTTコム 直接${ntt.totals.directCount}件(期待${expected.directCount}) ` +
      `再委託${ntt.totals.subcontractCount}件(期待${expected.subcontractCount})。` +
      `データ更新による変動なら期待値を更新してください`
    );
  } else {
    console.log(
      `✅ 回帰チェックOK: NTTコム 直接${ntt.totals.directCount}件 ` +
      `${(ntt.totals.directAmount / 1e8).toFixed(1)}億円 / ` +
      `再委託${ntt.totals.subcontractCount}件 ${(ntt.totals.subcontractAmount / 1e8).toFixed(1)}億円`
    );
  }
}

// ─── 出力 ──────────────────────────────────────────────

// redirects から実在エントリと衝突するキーを除去する。
// 誤記載cn（例 4000020330001）は別名では正規番号(岡山県)として実在しうる。
// その場合は API が実在エントリを優先して返すため、redirect は不要かつ誤解を招く。
for (const k of Object.keys(redirects)) {
  if (entries.has(k)) delete redirects[k];
}
console.log(`  キー互換 redirects: ${Object.keys(redirects).length} 件（実在キーと衝突する分は除去済み）`);

const output: RecipientIndex = {
  metadata: {
    year: YEAR,
    generatedAt: new Date().toISOString(),
    sourceFile: SOURCE_FILE,
    recipientCount: entries.size,
    appearanceCount,
    notes: [
      '全金額は1円単位です',
      '直接受注額(directAmount)と再委託受注額(subcontractAmount)の合算は二重計上になります。分離して扱ってください',
      '支出先名「その他」および空欄は集約行のためインデックス対象外です',
      'キーは法人番号13桁、法人番号がない支出先は "name:正規化名" です',
      '誤記載統合・番号補完(houjin.db裏取り)を適用済み。付け替わった旧キーは redirects で現行キーへ案内します',
      '解決で付け替わった出現は appearance.rawCorporateNumber に元データの生法人番号("" = 欠落)を保持します',
    ],
  },
  recipients: Object.fromEntries(entries),
  redirects,
};

const outPath = path.join(DATA_DIR, OUTPUT_FILE);
fs.writeFileSync(outPath, JSON.stringify(output));
const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
console.log(
  `✅ ${OUTPUT_FILE} 生成完了: 支出先 ${entries.size} 件 / 出現 ${appearanceCount} 行 ` +
  `/ 除外 ${excludedCount} 行 / ${sizeMB}MB`
);
