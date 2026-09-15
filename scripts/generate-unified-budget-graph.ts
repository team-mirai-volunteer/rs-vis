/**
 * 統合ビュー（/budget-sankey）用の統合グラフ生成スクリプト。
 *
 * 会計 → 所管 → 組織/勘定 → 項 → 目 → 事業区分（RS事業 / 非事業支出 / 未突合）→ 事業(支出) → 支出先
 * を1本のグラフにする。設計: docs/tasks/20260913_0428_財務省予算書とRS事業の完全統合サンキー設計.md（3章・4.1）
 *
 * 使用法:
 *   tsx scripts/generate-unified-budget-graph.ts --budget-year 2024 [--sheet 2025] [--basis initial|supplementary|settlement]
 *   --sheet 省略時は 予算年度+1（執行年度として扱う。sankey-svg-{sheet}-graph.json があれば支出先まで繋ぐ）。
 *   予算年度 = シート年度（予算のみ）、予算年度 = シート年度+1（要求→査定）も同じコマンドで生成できる。
 *
 * 入力:
 *   public/data/mof-kou-moku-{予算年度}.json             … MOF目（一般＋特別会計・basis予算種別）
 *   public/data/mof-rs-kou-moku-linkage-{予算年度}.json  … 目↔RS事業（generate-mof-rs-kou-moku-linkage.ts）
 *   public/data/sankey-svg-{シート年度}-graph.json        … 事業・支出先（執行年度のみ。無ければ事業ノードは紐づけ表から作る）
 *   public/data/mof-budget-overview-{予算年度}.json       … 参考値（純計）。無くてもよい
 *
 * 出力: public/data/unified-budget-{予算年度}-graph.json（.gz で Git 管理、prebuild で展開）
 *
 * 金額の基準（types/unified-budget.ts の冒頭コメント参照）:
 *   会計〜目〜事業区分は MOF目の basis（既定 initial=当初予算。supplementary=補正後、settlement=決算の支出済額）。
 *   補正基準は「当初予算の目 ＋ 補正予算書が載せた項の差し替え」。補正予算書は増減のあった項しか載せないため
 *   （2026年度は 2 所管のみ）、当初と合体しないと触れていない省庁が丸ごと欠ける。
 *   RS事業ノードは basis に応じて 当初予算 / 当初＋補正 / 執行額（執行年度以外は 2-2 の合計）。
 *   加えて基準に依らない歳出予算現額を rsCurrentBudget に持たせる（府省庁基準が使う）。
 *   当初予算 0 円（補正・繰越のみ）の事業は value 0 のまま出力し、予算書の基準では表示側が落とす。
 *   差分は擬似ノード outside からの流入で釣り合わせる。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { MOFBudgetType } from '@/types/mof-jikou';
import type { MOFKouMokuData, MOFKouMokuItem } from '@/types/mof-kou-moku';
import type { MofRsKouMokuLinkageData } from '@/types/mof-rs-kou-moku-linkage';
import type { GraphData, RawNode } from '@/types/sankey-svg';
import type {
  UnifiedColumn,
  UnifiedEdge,
  UnifiedGraph,
  UnifiedNode,
  UnifiedProgramKind,
} from '@/types/unified-budget';
import {
  UNIFIED_BASES,
  UNIFIED_BASIS_LABELS,
  UNIFIED_BASIS_MOF_BUDGET_TYPE,
  UNIFIED_BASIS_RS_MEASURE,
  UNIFIED_COLUMNS,
  UNIFIED_PROGRAM_KIND_LABELS,
  unifiedGraphFileName,
  type UnifiedBasis,
} from '@/types/unified-budget';

// ─── 引数 ──────────────────────────────────────────────
function argNum(name: string): number | undefined {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  const v = parseInt(process.argv[i + 1] ?? '', 10);
  if (isNaN(v)) {
    console.error(`${name} の値が不正です: ${process.argv[i + 1]}`);
    process.exit(1);
  }
  return v;
}
function argStr(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BUDGET_YEAR = argNum('--budget-year');
if (!BUDGET_YEAR) {
  console.error('使用法: tsx scripts/generate-unified-budget-graph.ts --budget-year <予算年度> [--sheet <RSシート年度>] [--basis initial|supplementary|settlement]');
  process.exit(1);
}
const SHEET_YEAR: number = argNum('--sheet') ?? BUDGET_YEAR + 1;
const BASIS_KEY = (argStr('--basis') ?? 'initial') as UnifiedBasis;
if (!UNIFIED_BASES.includes(BASIS_KEY)) {
  console.error(`❌ --basis は ${UNIFIED_BASES.join(' | ')} のいずれか（指定: ${BASIS_KEY}）`);
  process.exit(1);
}
/** MOF 目の予算種別（会計〜目の流量の出典） */
const BASIS: MOFBudgetType = UNIFIED_BASIS_MOF_BUDGET_TYPE[BASIS_KEY];
/** 目 1 件の流量。決算は歳出予算額ではなく支出済歳出額を使う */
const flowAmount = (it: MOFKouMokuItem): number => (BASIS_KEY === 'settlement' ? it.spent ?? 0 : it.amount);
/** RS事業ノードの値（執行年度・budgetSummary があるとき）。基準に合わせた測定量を選ぶ */
const rsMeasure = (n: RawNode): number => {
  const b = n.budgetSummary;
  if (!b) return n.value;
  if (BASIS_KEY === 'initial') return b.initialBudget;
  if (BASIS_KEY === 'supplementary') return b.initialBudget + b.supplementaryBudget;
  return b.executedAmount;
};

const DATA_DIR = path.join(__dirname, '../public/data');
const KOU_MOKU_FILE = path.join(DATA_DIR, `mof-kou-moku-${BUDGET_YEAR}.json`);
const LINKAGE_FILE = path.join(DATA_DIR, `mof-rs-kou-moku-linkage-${BUDGET_YEAR}.json`);
const SVG_GRAPH_FILE = path.join(DATA_DIR, `sankey-svg-${SHEET_YEAR}-graph.json`);
const OVERVIEW_FILE = path.join(DATA_DIR, `mof-budget-overview-${BUDGET_YEAR}.json`);
const OUTPUT_FILE = path.join(DATA_DIR, unifiedGraphFileName(BUDGET_YEAR, BASIS_KEY));

/** .json が無ければ .json.gz を読む */
function readJsonMaybeGz<T>(file: string): T | null {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  if (fs.existsSync(`${file}.gz`)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString('utf-8')) as T;
  return null;
}

// ─── ノードID ──────────────────────────────────────────
const ACCOUNT_GENERAL_ID = 'acct-general';
const accountId = (it: MOFKouMokuItem) => (it.accountType === 'general' ? ACCOUNT_GENERAL_ID : `acct-sp-${it.specialAccount}`);
const ministryId = (it: MOFKouMokuItem) => `min-${it.ministry}`;
const orgOf = (it: MOFKouMokuItem) => (it.accountType === 'special' ? it.specialAccount : it.organization);
const orgId = (it: MOFKouMokuItem) => `org-${it.accountType}|${it.ministry}|${orgOf(it)}|${it.subAccount}`;
const sectionId = (it: MOFKouMokuItem) => `sec-${it.accountType}|${it.ministry}|${orgOf(it)}|${it.subAccount}|${it.sectionCode}|${it.sectionName}`;
const koumokuId = (it: MOFKouMokuItem) => `km-${it.key}`;
/** 全角・空白をならして識別子に使う */
const norm = (t: string) => t.normalize('NFKC').replace(/\s+/g, '');
/** 項の識別子（予算種別を含まない）。補正予算の差し替え単位 */
const sectionIdentity = (it: MOFKouMokuItem) =>
  [it.accountType, norm(it.ministry), norm(orgOf(it) ?? ''), norm(it.subAccount ?? ''), it.sectionCode].join('|');

/**
 * 補正基準の目一覧 = 当初予算の目 に 補正予算書の目を項単位で差し替えたもの。
 *
 * 補正予算書は増減のあった項だけを「改予算額」で載せ、触れていない項は当初予算のまま据え置く。
 * 目単位では補正側が「…外N目」に束ねられていて当初と 1:1 対応しないため、項単位で入れ替える
 * （目単位で足すと束ね分が二重計上になり、2023年度で 86 兆円ほど過大になる）。
 */
function mergeSupplementaryItems(all: MOFKouMokuItem[], inScope: (it: MOFKouMokuItem) => boolean): MOFKouMokuItem[] {
  const supplementary = all.filter(it => inScope(it) && it.budgetType === '補正予算（第1号）');
  if (supplementary.length === 0) return [];
  const touched = new Set(supplementary.map(sectionIdentity));
  const untouched = all.filter(it => inScope(it) && it.budgetType === '当初予算' && !touched.has(sectionIdentity(it)));
  return [...untouched, ...supplementary];
}
const programId = (pid: number) => `project-budget-${pid}`;
const kindNodeId = (kind: UnifiedProgramKind) => `np-${kind}`;

/** 既定で折り畳む特別会計（他が視認できないほど大きい） */
function collapsedByDefault(specialAccount: string): boolean {
  return specialAccount.includes('国債整理基金') || specialAccount.includes('交付税及び譲与税配付金');
}

/**
 * 目の残余（RS事業に流れなかった分）の区分。設計 3.4 の判定順。
 * 「他会計へ繰入」を最優先にするのは、国債費・交付税の大半が特会への繰入として計上されるため
 * （繰入として扱わないと純計が出せない）。
 */
function classifyResidual(it: MOFKouMokuItem): UnifiedProgramKind {
  if (it.purposeCode === '6') return 'transfer';
  if (it.majorExpenseCode === '20') return 'debt';
  if (it.majorExpenseCode === '31' || it.majorExpenseCode === '32' || it.majorExpenseCode === '33') return 'local-transfer';
  if (it.majorExpenseCode === '98' || /^(107|108|109|110)$/.test(it.objectiveCode)) return 'reserve';
  if (it.purposeCode === '1' || it.purposeCode === '2') return 'personnel';
  return 'unmatched';
}

function main() {
  console.log(`=== 統合グラフ生成 (予算年度${BUDGET_YEAR} / RSシート${SHEET_YEAR} / 基準: ${BASIS_KEY}=${BASIS}) ===\n`);

  // 1. 入力
  console.log('[1/5] 入力読み込み');
  const kouMoku = readJsonMaybeGz<MOFKouMokuData>(KOU_MOKU_FILE);
  if (!kouMoku) {
    console.error(`❌ ${KOU_MOKU_FILE}(.gz) がありません`);
    process.exit(1);
  }
  const linkage = readJsonMaybeGz<MofRsKouMokuLinkageData>(LINKAGE_FILE);
  if (!linkage) {
    console.error(`❌ ${LINKAGE_FILE}(.gz) がありません。generate-mof-rs-kou-moku-linkage.ts を先に実行してください`);
    process.exit(1);
  }
  if (linkage.metadata.rsSheetYear === undefined) {
    // 旧形式の紐づけ表（2023 など）: metadata に rsSheetYear / rsAmountKind / projects[] が無い。
    // --sheet の年度で作られたものとみなし、金額の意味は予算額（'budget'）として扱う
    console.warn(`⚠️  紐づけ表 ${path.basename(LINKAGE_FILE)} は旧形式（rsSheetYear 無し）。--sheet ${SHEET_YEAR} のRSシート・予算額（budget）とみなして続行します`);
  } else if (linkage.metadata.rsSheetYear !== SHEET_YEAR) {
    console.error(`❌ 紐づけ表のRSシート年度 ${linkage.metadata.rsSheetYear} と --sheet ${SHEET_YEAR} が一致しません`);
    process.exit(1);
  }
  const isRequest = linkage.metadata.rsAmountKind === 'request';
  /** 執行年度（シート年度-1）だけ支出先まで繋ぐ。予算のみ・要求の年度は sankey-svg グラフの年度が合わない */
  const svgGraph = BUDGET_YEAR === SHEET_YEAR - 1 ? readJsonMaybeGz<GraphData>(SVG_GRAPH_FILE) : null;
  const overview = readJsonMaybeGz<{ totals?: { net?: number } }>(OVERVIEW_FILE);
  console.log(`  MOF目: ${kouMoku.items.length.toLocaleString()} 件 / 紐づけ: ${linkage.links.length.toLocaleString()} 件 (${linkage.metadata.rsAmountKind}) / sankey-svg: ${svgGraph ? `${svgGraph.nodes.length.toLocaleString()} ノード` : '無し（事業ノードは紐づけ表から作成）'}`);

  const inGeneralOrSpecial = (it: MOFKouMokuItem) => it.accountType === 'general' || it.accountType === 'special';
  const inAgency = (it: MOFKouMokuItem) => it.accountType === 'agency';
  const items = (
    BASIS_KEY === 'supplementary'
      ? mergeSupplementaryItems(kouMoku.items, inGeneralOrSpecial)
      : kouMoku.items.filter(it => inGeneralOrSpecial(it) && it.budgetType === BASIS)
  ) as (MOFKouMokuItem & { accountType: 'general' | 'special' })[];
  const agencyItems =
    BASIS_KEY === 'supplementary'
      ? mergeSupplementaryItems(kouMoku.items, inAgency)
      : kouMoku.items.filter(it => inAgency(it) && it.budgetType === BASIS);
  const agencyTotal = agencyItems.reduce((s, it) => s + flowAmount(it), 0);
  if (BASIS_KEY === 'supplementary') {
    const sup = items.filter(it => it.budgetType === '補正予算（第1号）');
    console.log(`  補正の目 ${sup.length.toLocaleString()} 件（${new Set(sup.map(sectionIdentity)).size.toLocaleString()} 項）で当初予算の項を差し替え、残り ${(items.length - sup.length).toLocaleString()} 件は当初予算のまま`);
  }
  if (items.length === 0) {
    console.error(`❌ 予算種別「${BASIS}」の目がありません（収録: ${kouMoku.metadata.budgetTypes.join(', ')}）`);
    process.exit(1);
  }
  console.log(`  対象目（一般＋特別・${BASIS}${BASIS_KEY === 'settlement' ? '・支出済額' : ''}）: ${items.length.toLocaleString()} 件 / ${(items.reduce((s, it) => s + flowAmount(it), 0) / 1e12).toFixed(2)} 兆円`);

  // 2. MOF階層ノード
  console.log('\n[2/5] 会計→所管→組織/勘定→項→目');
  const nodes = new Map<string, UnifiedNode>();
  const edgeMap = new Map<string, UnifiedEdge>();
  const addEdge = (source: string, target: string, value: number, extra?: Partial<UnifiedEdge>) => {
    if (value <= 0) return;
    const k = `${source}→${target}`;
    const e = edgeMap.get(k);
    if (e) {
      e.value += value;
      if (extra?.rawValue !== undefined) e.rawValue = (e.rawValue ?? 0) + extra.rawValue;
      if (extra?.isScaled) e.isScaled = true;
    } else {
      edgeMap.set(k, { source, target, value, ...extra });
    }
  };
  const ensure = (node: UnifiedNode): UnifiedNode => {
    const n = nodes.get(node.id);
    if (n) {
      n.value += node.value;
      return n;
    }
    nodes.set(node.id, node);
    return node;
  };

  for (const it of items) {
    const v = flowAmount(it);
    if (v <= 0) continue; // 負・0の目は流量にならない（減額補正など）
    const isSpecial = it.accountType === 'special';
    ensure({
      id: accountId(it),
      col: 'account',
      name: isSpecial ? it.specialAccount : '一般会計',
      value: v,
      accountType: it.accountType,
      ...(isSpecial && collapsedByDefault(it.specialAccount) ? { collapsedByDefault: true } : {}),
    });
    ensure({ id: ministryId(it), col: 'ministry', name: it.ministry, value: v, ministry: it.ministry });
    ensure({
      id: orgId(it),
      col: 'organization',
      name: isSpecial ? (it.subAccount ? `${it.specialAccount}／${it.subAccount}` : it.specialAccount) : it.organization,
      value: v,
      accountType: it.accountType,
      ministry: it.ministry,
      organization: orgOf(it),
      subAccount: it.subAccount,
    });
    ensure({
      id: sectionId(it),
      col: 'section',
      name: it.sectionName,
      value: v,
      accountType: it.accountType,
      ministry: it.ministry,
      organization: orgOf(it),
      subAccount: it.subAccount,
      sectionCode: it.sectionCode,
      sectionName: it.sectionName,
    });
    ensure({
      id: koumokuId(it),
      col: 'koumoku',
      // 補正予算書は目の内訳を載せない項がある（2026年度の国債費など。subItemCode も空）。
      // そのままだと名前の無い目ノードが図に出るので、項名を借りて内訳が無いことを明示する。
      name: it.subItemName || `${it.sectionName}（目の内訳なし）`,
      value: v,
      accountType: it.accountType,
      ministry: it.ministry,
      organization: orgOf(it),
      subAccount: it.subAccount,
      sectionCode: it.sectionCode,
      sectionName: it.sectionName,
      subItemCode: it.subItemCode,
      subItemName: it.subItemName,
      majorExpenseCode: it.majorExpenseCode,
      purposeCode: it.purposeCode,
      objectiveCode: it.objectiveCode,
      ...(it.sourceUrl ? { sourceUrl: it.sourceUrl } : {}),
    });
    addEdge(accountId(it), ministryId(it), v);
    addEdge(ministryId(it), orgId(it), v);
    addEdge(orgId(it), sectionId(it), v);
    addEdge(sectionId(it), koumokuId(it), v);
  }
  const countCol = (col: UnifiedColumn) => [...nodes.values()].filter(n => n.col === col).length;
  console.log(`  会計 ${countCol('account')} / 所管 ${countCol('ministry')} / 組織・勘定 ${countCol('organization')} / 項 ${countCol('section').toLocaleString()} / 目 ${countCol('koumoku').toLocaleString()}`);

  // 3. 事業ノード（歳出予算現額）
  console.log('\n[3/5] 事業ノード');
  const programValue = new Map<number, number>();
  const programNode = new Map<number, UnifiedNode>();
  if (svgGraph) {
    for (const n of svgGraph.nodes) {
      if (n.type !== 'project-budget' || n.projectId === undefined) continue;
      programNode.set(n.projectId, {
        id: programId(n.projectId),
        col: 'program',
        name: n.name,
        value: rsMeasure(n),
        kind: 'rs',
        projectId: n.projectId,
        rsMinistry: n.ministry,
        // 歳出予算現額（sankey-svg の事業ノードの値）。基準に依らず持たせる。府省庁基準が使う
        rsCurrentBudget: n.value,
        accountCategory: n.accountCategory,
        ...(n.budgetSummary ? { budgetSummary: n.budgetSummary } : {}),
        ...(n.budgetBreakdown && n.budgetBreakdown.length > 0 ? { budgetBreakdown: n.budgetBreakdown } : {}),
        // 再委託の階層・再委託先名（絞り込み用）。sankey-svg と同じく再委託ありの事業だけが持つ
        ...(n.subcontractDepth !== undefined && n.subcontractDepth >= 2 ? { subcontractDepth: n.subcontractDepth } : {}),
        ...(n.subcontractRecipients && n.subcontractRecipients.length > 0 ? { subcontractRecipients: n.subcontractRecipients } : {}),
      });
      programValue.set(n.projectId, rsMeasure(n));
    }
    console.log(`  sankey-svg の事業: ${programNode.size.toLocaleString()} 件（${UNIFIED_BASIS_RS_MEASURE[BASIS_KEY]}）`);
  } else {
    for (const p of linkage.projects ?? []) {
      programNode.set(p.projectId, {
        id: programId(p.projectId),
        col: 'program',
        name: p.projectName,
        value: p.rsAmountTotal,
        kind: 'rs',
        projectId: p.projectId,
        rsMinistry: p.projectMinistry,
        rsCurrentBudget: p.rsAmountTotal,
      });
      programValue.set(p.projectId, p.rsAmountTotal);
    }
    console.log(`  紐づけ表の事業: ${programNode.size.toLocaleString()} 件（2-2 の合計${isRequest ? '・要求額' : ''}）`);
  }
  // 紐づけにあるが上の集合に無い事業（シート間の集合差）は紐づけ表の名前で補う
  for (const l of linkage.links) {
    if (l.mofBudgetType !== BASIS) continue;
    if (!programNode.has(l.projectId)) {
      programNode.set(l.projectId, {
        id: programId(l.projectId),
        col: 'program',
        name: l.projectName,
        value: 0,
        kind: 'rs',
        projectId: l.projectId,
        rsMinistry: l.projectMinistry,
      });
      programValue.set(l.projectId, 0);
    }
  }

  // 4. 目 → 事業 / 事業区分
  console.log('\n[4/5] 目 → RS事業 / 非事業区分');
  const linksByKouMoku = new Map<string, { pid: number; amount: number }[]>();
  // 補正基準では当初予算のままの目も残るので、当初・補正の両方のリンクを取り込む
  // （kouMokuKey は予算種別を含むので、目ごとに自分の種別のリンクだけが引ける）
  const linkBudgetTypes = BASIS_KEY === 'supplementary' ? new Set<string>([BASIS, '当初予算']) : new Set<string>([BASIS]);
  for (const l of linkage.links) {
    if (!linkBudgetTypes.has(l.mofBudgetType) || l.rsAmount <= 0) continue;
    const list = linksByKouMoku.get(l.kouMokuKey) ?? [];
    list.push({ pid: l.projectId, amount: l.rsAmount });
    linksByKouMoku.set(l.kouMokuKey, list);
  }
  // 補正基準: 補正予算書の目額は「改予算額」（当初＋補正の総額）だが、RS 2-2 の補正行は補正増減分しか
  // 持たない。同じ目（予算種別を除いた識別子が一致するもの）の当初予算リンクを足して総額に合わせる。
  // 「…外N目」に束ねられた補正目は当初側に対応が無く、残余は未突合として残る
  const identityOfLink = (l: (typeof linkage.links)[number]) =>
    [l.mofAccountType, norm(l.mofMinistry), norm(l.mofOrganization), norm(l.mofSubAccount ?? ''), l.sectionCode, l.subItemCode, norm(l.subItemName)].join('|');
  const identityOfItem = (it: MOFKouMokuItem) =>
    [it.accountType, norm(it.ministry), norm(orgOf(it) ?? ''), norm(it.subAccount ?? ''), it.sectionCode, it.subItemCode, norm(it.subItemName)].join('|');
  let mergedInitialLinks = 0;
  if (BASIS_KEY === 'supplementary') {
    const initialByIdentity = new Map<string, { pid: number; amount: number }[]>();
    for (const l of linkage.links) {
      if (l.mofBudgetType !== '当初予算' || l.rsAmount <= 0) continue;
      const id = identityOfLink(l);
      const list = initialByIdentity.get(id) ?? [];
      list.push({ pid: l.projectId, amount: l.rsAmount });
      initialByIdentity.set(id, list);
    }
    for (const it of items) {
      // 当初予算のまま残した目は自分の当初リンクを既に持っているので足さない（足すと二重計上になる）
      if (it.budgetType !== BASIS) continue;
      const extra = initialByIdentity.get(identityOfItem(it));
      if (!extra) continue;
      const list = linksByKouMoku.get(it.key) ?? [];
      const byPid = new Map<number, number>(list.map(x => [x.pid, x.amount]));
      for (const x of extra) byPid.set(x.pid, (byPid.get(x.pid) ?? 0) + x.amount);
      linksByKouMoku.set(it.key, [...byPid].map(([pid, amount]) => ({ pid, amount })));
      mergedInitialLinks += extra.length;
    }
    console.log(`  補正目へ当初予算リンクを合流: ${mergedInitialLinks.toLocaleString()} 件`);
  }
  /**
   * 補正予算書の「…外N目」に束ねられた目は使途別分類・主要経費のコードを持たず、そのままでは未突合に落ちる
   * （2026年度は国債整理基金特別会計への繰入 31 兆円が丸ごと未突合になっていた）。
   * 当初予算の同じ項で最も金額の大きい区分を引き継ぐ
   */
  const kindBySection = new Map<string, [UnifiedProgramKind, number][]>();
  if (BASIS_KEY === 'supplementary') {
    const perSection = new Map<string, Map<UnifiedProgramKind, number>>();
    for (const it of kouMoku.items) {
      if (it.budgetType !== '当初予算' || !(it.amount > 0)) continue;
      const id = sectionIdentity(it);
      const m = perSection.get(id) ?? new Map<UnifiedProgramKind, number>();
      const k = classifyResidual(it);
      m.set(k, (m.get(k) ?? 0) + it.amount);
      perSection.set(id, m);
    }
    for (const [id, m] of perSection) {
      const total = [...m.values()].reduce((a, b) => a + b, 0);
      if (total > 0) kindBySection.set(id, [...m].map(([kind, v]) => [kind, v / total] as [UnifiedProgramKind, number]).sort((a, b) => b[1] - a[1]));
    }
  }
  /**
   * 残余を区分へ割り振る。コードで分かればそれ 1 本、分からない補正の束ね目だけ
   * 当初予算の同じ項の構成比で按分する（最大の区分に寄せると人件費などが極端に膨らむ）
   */
  const splitResidual = (it: MOFKouMokuItem, residual: number): [UnifiedProgramKind, number][] => {
    const k = classifyResidual(it);
    if (k !== 'unmatched') return [[k, residual]];
    const mix = BASIS_KEY === 'supplementary' ? kindBySection.get(sectionIdentity(it)) : undefined;
    if (!mix) return [['unmatched', residual]];
    const out: [UnifiedProgramKind, number][] = [];
    let rest = residual;
    mix.forEach(([kind, share], i) => {
      const v = i === mix.length - 1 ? rest : Math.min(rest, Math.floor(residual * share));
      if (v > 0) out.push([kind, v]);
      rest -= v;
    });
    return out;
  };
  const byKind: Record<UnifiedProgramKind, number> = { rs: 0, transfer: 0, debt: 0, 'local-transfer': 0, reserve: 0, personnel: 0, unmatched: 0, outside: 0 };
  const linkedIn = new Map<number, number>(); // pid → 目からの流入合計
  let scaledDown = 0;
  let scaledEdges = 0;
  for (const it of items) {
    const itAmount = flowAmount(it);
    if (itAmount <= 0) continue;
    const kmId = koumokuId(it);
    const links = linksByKouMoku.get(it.key) ?? [];
    const rsSum = links.reduce((s, l) => s + l.amount, 0);
    const factor = rsSum > itAmount ? itAmount / rsSum : 1;
    if (factor < 1) scaledDown += rsSum - itAmount;
    let flowed = 0;
    for (const l of links) {
      const v = factor < 1 ? Math.floor(l.amount * factor) : l.amount;
      if (v <= 0) continue;
      addEdge(kmId, programId(l.pid), v, factor < 1 ? { isScaled: true, rawValue: l.amount } : undefined);
      if (factor < 1) scaledEdges++;
      linkedIn.set(l.pid, (linkedIn.get(l.pid) ?? 0) + v);
      flowed += v;
      byKind.rs += v;
    }
    const residual = itAmount - flowed;
    if (residual > 0) {
      for (const [kind, v] of splitResidual(it, residual)) {
        byKind[kind] += v;
        ensure({ id: kindNodeId(kind), col: 'program', name: UNIFIED_PROGRAM_KIND_LABELS[kind], value: v, kind });
        addEdge(kmId, kindNodeId(kind), v);
      }
    }
  }
  // 事業ノードの登録と outside 流入
  let outsideTotal = 0;
  let overLinked = 0;
  const outsideId = kindNodeId('outside');
  for (const [pid, node] of programNode) {
    const inFlow = linkedIn.get(pid) ?? 0;
    const target = programValue.get(pid) ?? 0;
    // 何も流れない事業は出さない。ただし歳出予算現額があるもの（当初予算 0 円＝補正・繰越のみの事業）は
    // 値 0 のまま残す: 府省庁基準がこの値を使うため。予算書の基準では表示側（toViewGraph）が落とす
    if (inFlow === 0 && target === 0 && !((node.rsCurrentBudget ?? 0) > 0)) continue;
    if (target < inFlow) {
      // 目からの流入が事業の値を上回る（2-2 > 2-1 など）。ノード値は流入に合わせる
      node.value = inFlow;
      overLinked++;
    } else if (target > inFlow) {
      const diff = target - inFlow;
      addEdge(outsideId, node.id, diff);
      outsideTotal += diff;
    }
    nodes.set(node.id, node);
  }
  if (outsideTotal > 0) {
    nodes.set(outsideId, {
      id: outsideId,
      col: 'koumoku',
      name: isRequest ? '要求額のうち予算書の目に対応しない分' : UNIFIED_PROGRAM_KIND_LABELS.outside,
      value: outsideTotal,
      kind: 'outside',
      standalone: true,
    });
    byKind.outside = outsideTotal;
  }
  console.log(`  RS事業へ ${(byKind.rs / 1e12).toFixed(2)} 兆円 / 繰入 ${(byKind.transfer / 1e12).toFixed(2)} / 国債費 ${(byKind.debt / 1e12).toFixed(2)} / 地方財政移転 ${(byKind['local-transfer'] / 1e12).toFixed(2)} / 予備費 ${(byKind.reserve / 1e12).toFixed(2)} / 人件費 ${(byKind.personnel / 1e12).toFixed(2)} / 未突合 ${(byKind.unmatched / 1e12).toFixed(2)} 兆円`);
  console.log(`  縮小: ${scaledEdges.toLocaleString()} エッジ / ${(scaledDown / 1e12).toFixed(3)} 兆円切り捨て、事業値を流入に合わせた事業: ${overLinked.toLocaleString()} 件、outside 流入: ${(outsideTotal / 1e12).toFixed(2)} 兆円`);

  // 5. 事業(支出)・支出先（sankey-svg から引き継ぎ）
  console.log('\n[5/5] 事業(支出)・支出先');
  if (svgGraph) {
    const svgNodeById = new Map<string, RawNode>(svgGraph.nodes.map(n => [n.id, n]));
    let spendingNodes = 0;
    let recipientNodes = 0;
    for (const n of svgGraph.nodes) {
      if (n.type === 'project-spending') {
        if (n.projectId === undefined || !nodes.has(programId(n.projectId))) continue;
        nodes.set(n.id, { id: n.id, col: 'program-spending', name: n.name, value: n.value, kind: 'rs', projectId: n.projectId, rsMinistry: n.ministry });
        spendingNodes++;
      } else if (n.type === 'recipient') {
        nodes.set(n.id, {
          id: n.id,
          col: 'recipient',
          name: n.name,
          value: n.value,
          ...(n.representativeCorporateNumber ? { representativeCorporateNumber: n.representativeCorporateNumber } : {}),
          ...(n.corporateNumberCount !== undefined ? { corporateNumberCount: n.corporateNumberCount } : {}),
        });
        recipientNodes++;
      }
    }
    let copied = 0;
    for (const e of svgGraph.edges) {
      const s = svgNodeById.get(e.source);
      const t = svgNodeById.get(e.target);
      if (!s || !t) continue;
      const ok = (s.type === 'project-budget' && t.type === 'project-spending') || (s.type === 'project-spending' && t.type === 'recipient');
      if (!ok) continue;
      if (!nodes.has(e.source) || !nodes.has(e.target)) continue;
      addEdge(e.source, e.target, e.value);
      copied++;
    }
    console.log(`  事業(支出) ${spendingNodes.toLocaleString()} / 支出先 ${recipientNodes.toLocaleString()} / エッジ ${copied.toLocaleString()} を引き継ぎ`);
  } else {
    console.log('  執行年度ではないため無し');
  }

  // 出力
  const nodeList = [...nodes.values()];
  const edgeList = [...edgeMap.values()];
  const gross = nodeList.filter(n => n.col === 'account').reduce((s, n) => s + n.value, 0);
  const rsProgram = nodeList.filter(n => n.col === 'program' && n.kind === 'rs').reduce((s, n) => s + n.value, 0);
  const counts = Object.fromEntries(UNIFIED_COLUMNS.map(c => [c, countCol(c)])) as Record<UnifiedColumn, number>;
  const graph: UnifiedGraph = {
    metadata: {
      budgetYear: BUDGET_YEAR as number,
      rsSheetYear: SHEET_YEAR,
      hasSpending: !!svgGraph,
      rsAmountKind: linkage.metadata.rsAmountKind ?? 'budget',
      basisBudgetType: BASIS,
      basis: BASIS_KEY,
      basisLabel: UNIFIED_BASIS_LABELS[BASIS_KEY],
      rsMeasureLabel: svgGraph ? UNIFIED_BASIS_RS_MEASURE[BASIS_KEY] : isRequest ? undefined : '予算額（2-2 合計）',
      eraLabel: kouMoku.metadata.eraLabel,
      unit: 'yen',
      generatedAt: new Date().toISOString(),
      totals: {
        gross,
        transfer: byKind.transfer,
        net: gross - byKind.transfer,
        rsLinked: byKind.rs,
        rsProgram,
        outside: outsideTotal,
        scaledDown,
        byKind,
        agency: agencyTotal,
        overviewNet: overview?.totals?.net ?? null,
      },
      counts: { ...counts, edges: edgeList.length, scaledEdges },
      collapsedAccounts: nodeList.filter(n => n.collapsedByDefault).map(n => n.id),
      notes: [
        `会計〜目〜事業区分の流量は MOF ${BUDGET_YEAR}年度「${BASIS}」の目金額${BASIS_KEY === 'settlement' ? '（支出済歳出額）' : BASIS_KEY === 'supplementary' ? '（改予算額。補正予算書に載る目のみ）' : ''}。予算種別間で目の識別子が一致しないため基準をまたいだ合算はしない`,
        isRequest
          ? `RS事業ノードの値は RSシート${SHEET_YEAR}の翌年度（${BUDGET_YEAR}年度）要求額の合計。目→事業の流量は目単位の要求額で、MOF当初予算との差が査定結果`
          : svgGraph
            ? `RS事業ノードの値は RS 2-1 の${UNIFIED_BASIS_RS_MEASURE[BASIS_KEY]}。目からの流入（${BASIS}）との差分は擬似ノード「${UNIFIED_PROGRAM_KIND_LABELS.outside}」からの流入`
            : `RS事業ノードの値は RSシート${SHEET_YEAR}の 2-2（予算年度${BUDGET_YEAR}行）の合計（繰越・予備費等を含む）。目からの流入との差分は擬似ノードからの流入`,
        '目の残余（RS事業に流れなかった分）は 使途別分類6=他会計へ繰入 → 主要経費20=国債費 → 主要経費31/32/33=地方財政移転 → 主要経費98・目的別107〜110=予備費 → 使途別分類1/2=人件費・旅費 → それ以外=未突合 の順で区分する',
        '「他会計へ繰入」は会計間の重複。純計 = 会計列合計 − 繰入',
        '同一目に複数事業が付き合計が目額を超える場合は比例縮小し isScaled を付ける（rawValue が縮小前）',
        '政府関係機関はRS側に会計区分が無いためグラフに含めない（totals.agency に参考値）',
        '国債整理基金特別会計・交付税及び譲与税配付金特別会計は既定で折り畳む（collapsedAccounts）',
      ],
    },
    nodes: nodeList,
    edges: edgeList,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(graph));
  console.log(`\n  ✅ ${path.basename(OUTPUT_FILE)} (${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ノード ${nodeList.length.toLocaleString()} / エッジ ${edgeList.length.toLocaleString()}`);
  console.log(`  総計（重複込み） ${(gross / 1e12).toFixed(2)} 兆円 / 繰入 ${(byKind.transfer / 1e12).toFixed(2)} / 純計 ${((gross - byKind.transfer) / 1e12).toFixed(2)} 兆円${overview?.totals?.net ? `（mof-budget-overview 純計 ${(overview.totals.net / 1e12).toFixed(2)}）` : ''}`);
  console.log(`  RS事業ノード合計 ${(rsProgram / 1e12).toFixed(2)} 兆円（目から ${(byKind.rs / 1e12).toFixed(2)} + outside ${(outsideTotal / 1e12).toFixed(2)}）`);
}

main();
