/**
 * エンティティ名正規化辞書生成スクリプト
 *
 * 5-1 CSV から全支出先名を読み込み、ルールベース分類と Claude API を組み合わせて
 * data/entity-normalization.json を生成する。
 *
 * Usage:
 *   tsx scripts/generate-entity-dict.ts
 *
 * 環境変数:
 *   ANTHROPIC_API_KEY  Claude API キー（LLM 分類に必要）
 *   LLM_BATCH_SIZE     1バッチあたりのエントリ数（デフォルト: 80）
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { readShiftJISCSV } from './csv-reader';
import type { EntityType } from '../types/structured';
import type { SpendingInfo } from '../types/rs-system';

const CSV_PATH = path.join(__dirname, '../data/year_2024/5-1_RS_2024_支出先_支出情報.csv');
const OUTPUT_PATH = path.join(__dirname, '../public/data/entity-normalization.json');

// ========================================
// 型定義
// ========================================

interface EntityEntry {
  displayName: string;
  entityType: EntityType;
  parentName?: string;
}

type EntityDict = Record<string, EntityEntry>;

// ========================================
// 法人種別コード → EntityType マッピング
// （399 は混在するため対象外）
// ========================================

const CORPORATE_TYPE_MAP: Record<string, EntityType> = {
  '101': '国の機関',
  '201': '地方公共団体',
  '301': '民間企業',
  '302': '民間企業',
  '303': '民間企業',
  '304': '民間企業',
  '305': '民間企業',
  '401': '外国法人',
  '499': 'その他',
};

// ========================================
// 名称内の省略形プレフィックス → EntityType
// ========================================

const ABBREV_PREFIX_TYPES: [string, EntityType][] = [
  ['(株)', '民間企業'],
  ['（株）', '民間企業'],
  ['(有)', '民間企業'],
  ['（有）', '民間企業'],
  ['(合)', '民間企業'],
  ['（合）', '民間企業'],
  ['(同)', '民間企業'],
  ['（同）', '民間企業'],
  ['(一財)', '公益法人・NPO'],
  ['（一財）', '公益法人・NPO'],
  ['(公財)', '公益法人・NPO'],
  ['（公財）', '公益法人・NPO'],
  ['(一社)', '公益法人・NPO'],
  ['（一社）', '公益法人・NPO'],
  ['(公社)', '公益法人・NPO'],
  ['（公社）', '公益法人・NPO'],
  ['(特非)', '公益法人・NPO'],
  ['（特非）', '公益法人・NPO'],
  ['(独)', '独立行政法人'],
  ['（独）', '独立行政法人'],
  ['(国研)', '独立行政法人'],
  ['（国研）', '独立行政法人'],
];

// 正式法人格プレフィックス → EntityType
const FULL_PREFIX_TYPES: [string, EntityType][] = [
  ['株式会社', '民間企業'],
  ['有限会社', '民間企業'],
  ['合同会社', '民間企業'],
  ['合資会社', '民間企業'],
  ['合名会社', '民間企業'],
  ['独立行政法人', '独立行政法人'],
  ['国立研究開発法人', '独立行政法人'],
  ['一般社団法人', '公益法人・NPO'],
  ['一般財団法人', '公益法人・NPO'],
  ['公益社団法人', '公益法人・NPO'],
  ['公益財団法人', '公益法人・NPO'],
  ['特定非営利活動法人', '公益法人・NPO'],
  ['NPO法人', '公益法人・NPO'],
  ['学校法人', '公益法人・NPO'],
  ['医療法人', '公益法人・NPO'],
  ['社会福祉法人', '公益法人・NPO'],
  ['宗教法人', '公益法人・NPO'],
  ['弁護士法人', '民間企業'],
  ['税理士法人', '民間企業'],
  ['監査法人', '民間企業'],
  ['有限責任監査法人', '民間企業'],
];

// 正式法人格（除去対象のもの）
const CORP_FORM_PATTERNS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
  '独立行政法人', '国立研究開発法人',
  '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
  '特定非営利活動法人', 'NPO法人',
  '学校法人', '医療法人', '社会福祉法人', '宗教法人',
  '弁護士法人', '税理士法人', '監査法人', '有限責任監査法人',
];

// 支店・支社サフィックスパターン
const BRANCH_SUFFIXES = ['支店', '支社', '出張所', '営業所'];

// 国の出先機関キーワード（名称に含まれれば「国の機関」と判定）
// 農政局・財務局・地方整備局など、民間や地方公共団体とは重複しない語
// 注意: 「税関」は「世界税関機構」(国際機関)に誤マッチするため除外
// 注意: 「法務局」は「〇〇法務局」の形で機能するが「○○法人」は含まない
const GOVERNMENT_OFFICE_KEYWORDS: string[] = [
  '農政局', '農政事務所',
  '地方整備局', '地方航空局', '地方環境事務所',
  '地方厚生局', '地方運輸局', '地方経済産業局',
  '財務局',
  '地方法務局', '法務局',
  '矯正管区', '刑務所', '拘置所', '少年院', '保護観察所',
  '公安調査局', '入国在留管理局',
  '高等裁判所', '地方裁判所', '家庭裁判所', '簡易裁判所',
];

// ========================================
// ユーティリティ関数
// ========================================

function stripCorporateForm(name: string): string {
  let result = name;

  // 省略形プレフィックス除去
  for (const [abbrev] of ABBREV_PREFIX_TYPES) {
    if (result.startsWith(abbrev)) {
      result = result.slice(abbrev.length).trim();
      break;
    }
  }

  // 正式法人格プレフィックス除去
  for (const prefix of CORP_FORM_PATTERNS) {
    if (result.startsWith(prefix)) {
      result = result.slice(prefix.length).trim();
      break;
    }
  }

  // 正式法人格サフィックス除去
  for (const suffix of ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社']) {
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
      break;
    }
  }

  return result || name; // 空になったら元の名称にフォールバック
}

function detectEntityTypeFromName(name: string): EntityType | null {
  // 省略形プレフィックスをチェック
  for (const [abbrev, type] of ABBREV_PREFIX_TYPES) {
    if (name.startsWith(abbrev)) return type;
  }

  // 正式法人格プレフィックスをチェック
  for (const [prefix, type] of FULL_PREFIX_TYPES) {
    if (name.startsWith(prefix)) return type;
  }

  // 地方公共団体パターン（末尾が都道府県・市区町村）
  if (/[都道府県]$/.test(name) || /[市区町村]$/.test(name)) {
    return '地方公共団体';
  }

  // 国の出先機関キーワード
  for (const keyword of GOVERNMENT_OFFICE_KEYWORDS) {
    if (name.includes(keyword)) return '国の機関';
  }

  return null;
}

function detectBranchParent(displayName: string): string | undefined {
  for (const suffix of BRANCH_SUFFIXES) {
    const idx = displayName.indexOf(suffix);
    if (idx > 0) {
      const base = displayName.slice(0, idx).trim();
      if (base && base !== displayName) return base;
    }
  }
  return undefined;
}

function applyRuleBased(name: string, corporateType: string, cn?: string): EntityEntry | null {
  // 1. 名称プレフィックス・キーワードによる判定（最優先）
  const nameType = detectEntityTypeFromName(name);
  if (nameType) {
    const displayName = stripCorporateForm(name);
    const parentName = detectBranchParent(displayName);
    const entry: EntityEntry = { displayName, entityType: nameType };
    if (parentName) entry.parentName = parentName;
    return entry;
  }

  // 2. 法人種別コードによる判定（399 は混在するためスキップ）
  const codeType = CORPORATE_TYPE_MAP[corporateType];
  if (codeType) {
    const displayName = stripCorporateForm(name);
    const parentName = detectBranchParent(displayName);
    const entry: EntityEntry = { displayName, entityType: codeType };
    if (parentName) entry.parentName = parentName;
    return entry;
  }

  // 3. 判定不能 → LLM へ
  return null;
}

// ========================================
// LLM 分類
// ========================================

async function classifyWithLLM(
  client: Anthropic,
  batch: { name: string; corporateType: string }[]
): Promise<EntityDict> {
  const inputLines = batch
    .map(e => `"${e.name}" (法人種別コード: ${e.corporateType || 'なし'})`)
    .join('\n');

  const prompt = `以下は日本政府の支出先データに登場する法人名の一覧です。各法人について判定してください。

【判定項目】
1. displayName: 法人格（株式会社・有限会社等のプレフィックス/サフィックス、(株)等の省略形）を除いた表示名。支店・支社名はそのまま残す。
2. entityType: 以下の7分類のいずれか1つ:
   - 民間企業（株式会社・有限会社・合同会社・弁護士法人等）
   - 地方公共団体（都道府県・市区町村・特別区等）
   - 国の機関（省庁・外局・裁判所・検察・自衛隊等）
   - 独立行政法人（独立行政法人・国立研究開発法人）
   - 公益法人・NPO（公益財団・公益社団・一般財団・一般社団・特定非営利・学校法人・医療法人等）
   - 外国法人（海外の企業・団体）
   - その他（協議会・組合・JV・コンソーシアム・個人・不明等）
3. parentName: 支店・支社の場合のみ、親会社のdisplayNameを記載（不要な場合は省略）

【入力法人名一覧】
${inputLines}

【重要】必ずJSON形式のみで回答してください（説明文不要）。形式:
{"法人名": {"displayName": "表示名", "entityType": "分類", "parentName": "親会社名（省略可）"}, ...}`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected LLM response type');

  // JSON部分を抽出（前後に余分なテキストがある場合に対応）
  const text = content.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn('  ⚠️ JSONが見つかりません:', text.slice(0, 200));
    return {};
  }

  try {
    return JSON.parse(jsonMatch[0]) as EntityDict;
  } catch (e) {
    console.warn('  ⚠️ JSON解析失敗:', jsonMatch[0].slice(0, 200));
    return {};
  }
}

// ========================================
// メイン処理
// ========================================

async function main() {
  console.log('エンティティ名正規化辞書生成開始...\n');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSVファイルが見つかりません: ${CSV_PATH}`);
    console.error('npm run normalize を先に実行してください');
    process.exit(1);
  }

  // CSV 読み込み
  console.log('5-1 CSV 読み込み中...');
  const rows = readShiftJISCSV(CSV_PATH) as unknown as SpendingInfo[];

  // ユニーク支出先名を抽出（法人種別コード・法人番号も保持）
  const entities = new Map<string, { corporateType: string; cn: string }>();
  for (const row of rows) {
    const name = row['支出先名']?.trim();
    if (!name) continue;
    if (!entities.has(name)) {
      entities.set(name, {
        corporateType: row['法人種別']?.trim() || '',
        cn: row['法人番号']?.trim() || '',
      });
    }
  }
  console.log(`✓ ユニーク支出先名: ${entities.size.toLocaleString()}件\n`);

  // ルールベース分類
  console.log('ルールベース分類中...');
  const ruleBasedDict: EntityDict = {};
  const needsLLM: { name: string; corporateType: string }[] = [];

  for (const [name, { corporateType, cn }] of entities) {
    const entry = applyRuleBased(name, corporateType, cn);
    if (entry) {
      ruleBasedDict[name] = entry;
    } else {
      needsLLM.push({ name, corporateType });
    }
  }
  console.log(`✓ ルールベースで分類: ${Object.keys(ruleBasedDict).length.toLocaleString()}件`);
  console.log(`✓ LLM分類が必要: ${needsLLM.length.toLocaleString()}件\n`);

  // 既存辞書を読み込み（前回実行の LLM 結果を再利用）
  let existingLLMDict: EntityDict = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as EntityDict;
      // ルールベースに含まれない名称だけ既存から引き継ぐ
      for (const [name, entry] of Object.entries(existing)) {
        if (!(name in ruleBasedDict)) {
          existingLLMDict[name] = entry;
        }
      }
      console.log(`✓ 既存辞書から引き継ぎ: ${Object.keys(existingLLMDict).length.toLocaleString()}件`);
    } catch {
      console.warn('⚠️ 既存辞書の読み込みに失敗しました（新規作成します）');
    }
  }

  // 新規に LLM 処理が必要な名称
  const toProcess = needsLLM.filter(e => !(e.name in existingLLMDict));
  console.log(`✓ LLM処理対象（新規）: ${toProcess.length.toLocaleString()}件\n`);

  // LLM バッチ処理
  const llmDict: EntityDict = { ...existingLLMDict };

  if (toProcess.length > 0) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('❌ ANTHROPIC_API_KEY が設定されていません');
      console.error('  export ANTHROPIC_API_KEY=your-key を実行してから再試行してください');
      console.error('  LLM未分類エントリはルールベース結果のみで保存します');
    } else {
      const client = new Anthropic({ apiKey });
      const BATCH_SIZE = parseInt(process.env.LLM_BATCH_SIZE || '80', 10);
      const batches: { name: string; corporateType: string }[][] = [];
      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        batches.push(toProcess.slice(i, i + BATCH_SIZE));
      }

      console.log(`LLM分類開始（${batches.length}バッチ × 最大${BATCH_SIZE}件）...`);
      for (let i = 0; i < batches.length; i++) {
        process.stdout.write(`  バッチ ${i + 1}/${batches.length} 処理中...`);
        try {
          const results = await classifyWithLLM(client, batches[i]);
          const count = Object.keys(results).length;
          process.stdout.write(` ${count}件分類\n`);
          Object.assign(llmDict, results);

          // バッチごとに中間保存
          const interim = { ...ruleBasedDict, ...llmDict };
          fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
          fs.writeFileSync(OUTPUT_PATH, JSON.stringify(interim, null, 2), 'utf-8');
        } catch (e) {
          process.stdout.write(` ❌ エラー: ${e}\n`);
        }

        // レート制限対策
        if (i < batches.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      console.log('✓ LLM分類完了\n');
    }
  }

  // 最終マージと保存
  // 優先度: ルールベース > LLM（ルールベースの方が信頼性が高い）
  const finalDict: EntityDict = { ...llmDict, ...ruleBasedDict };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalDict, null, 2), 'utf-8');

  // 統計出力
  const byType: Record<string, number> = {};
  for (const entry of Object.values(finalDict)) {
    byType[entry.entityType] = (byType[entry.entityType] || 0) + 1;
  }
  const branchCount = Object.values(finalDict).filter(e => e.parentName).length;

  console.log(`✅ 辞書生成完了: ${Object.keys(finalDict).length.toLocaleString()}件`);
  console.log(`  保存先: ${OUTPUT_PATH}\n`);
  console.log('【entityType 内訳】');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count.toLocaleString()}件`);
  }
  console.log(`  支店・支社（parentName あり）: ${branchCount}件`);
  console.log(`\n未分類（辞書なし）: ${(entities.size - Object.keys(finalDict).length).toLocaleString()}件`);
}

main().catch(e => {
  console.error('❌ エラー:', e);
  process.exit(1);
});
