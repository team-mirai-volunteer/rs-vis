/**
 * AI ナビの「〜に移動して」で行けるページ。ツール navigate_page の選択肢と、クライアントの遷移先。
 * components/navigation/pages.ts と同じ href を使う（app/lib は components を import しないので、ここに別表を持つ。
 * 整合は tests/nav-targets.test.ts で確認する）。
 *
 * 補助ビュー（概算要求・租税特別措置・国民負担・財政余力）はサンキー条件（SankeyQuery）ではなく
 * ページ固有の条件を URL に写す。その組み立て（navTargetHref）もここに置く。Pure 層（fs・fetch・React なし）。
 */
import { HOUSEHOLDS, initialTaxState } from '@/app/lib/tax-burden/households';
import { encodeTaxState } from '@/app/lib/tax-burden/reform-url';
import type { HouseholdId, TaxView } from '@/types/tax-burden';

export interface NavTarget {
  /** ツールに渡すキー */
  key: string;
  href: string;
  label: string;
  /** ユーザーの言い方（プロンプトの説明に使う） */
  aliases: string[];
}

export const NAV_TARGETS: readonly NavTarget[] = [
  { key: 'sankey', href: '/budget-sankey', label: 'サンキー図', aliases: ['サンキー', '流れの図'] },
  { key: 'bubble', href: '/project-bubble', label: 'バブル図', aliases: ['バブルチャート', '散布図'] },
  { key: 'quality', href: '/quality', label: '評価一覧', aliases: ['AI 評価', 'スコア一覧'] },
  { key: 'subcontracts', href: '/subcontracts', label: '委託構造', aliases: ['再委託', '委託'] },
  { key: 'vendors', href: '/vendors', label: '事業者', aliases: ['事業者別', '受注企業'] },
  { key: 'funds', href: '/funds', label: '基金', aliases: [] },
  { key: 'budget-requests', href: '/budget-requests', label: '概算要求', aliases: ['要求'] },
  { key: 'tax-expenditures', href: '/tax-expenditures', label: '租税特別措置', aliases: ['税優遇', '租特'] },
  { key: 'tax-burden', href: '/tax-burden', label: '国民負担', aliases: ['歳入', '税負担', '手取り'] },
  { key: 'fiscal-space', href: '/fiscal-space', label: '財政余力', aliases: ['シミュレータ', '次の1兆円'] },
  { key: 'home', href: '/', label: 'トップ', aliases: ['ホーム', '最初のページ'] },
];

export const NAV_TARGET_KEYS = NAV_TARGETS.map(t => t.key);
export const findNavTarget = (key: unknown): NavTarget | null =>
  (typeof key === 'string' ? NAV_TARGETS.find(t => t.key === key) ?? null : null);

/**
 * 財政余力の政策一覧（app/lib/fiscal-space/assumptions.ts の POLICIES と同じ id・名前）。
 * assumptions は日本経済の基礎データを抱えて重いので、プロンプトとツール定義にはこの写しを使う。
 * 整合は tests/nav-targets.test.ts で確認する。
 */
export const FISCAL_POLICIES: readonly { id: string; name: string }[] = [
  { id: 'income-tax', name: '所得税減税' },
  { id: 'resident-tax', name: '住民税減税' },
  { id: 'consumption-tax', name: '消費税減税（標準税率）' },
  { id: 'consumption-tax-reduced', name: '消費税減税（軽減税率）' },
  { id: 'social-insurance', name: '社会保険料の軽減' },
  { id: 'cash', name: '現金給付' },
  { id: 'public-investment', name: '公共投資' },
  { id: 'defence', name: '防衛' },
  { id: 'healthcare', name: '医療' },
  { id: 'childcare', name: '子育て' },
  { id: 'education', name: '教育' },
  { id: 'rd', name: '研究開発' },
  { id: 'semiconductors', name: '半導体・産業投資' },
  { id: 'grid', name: '送電網投資' },
  { id: 'generation', name: '発電設備投資' },
];
/** 政策 1 つに入れられる年額の上限（円）。画面の入力上限と同じ桁（100 兆円） */
export const FISCAL_POLICY_AMOUNT_MAX_YEN = 100e12;

export const TAX_EXPENDITURE_YEARS = ['2022', '2023', '2024'] as const;
export type TaxExpenditureYear = (typeof TAX_EXPENDITURE_YEARS)[number];
export const TAX_EXPENDITURE_VIEWS = ['amount', 'assessment', 'measures'] as const;
const TAX_BURDEN_VIEWS: readonly TaxView[] = ['curve', 'revenue', 'stats', 'age', 'heatmap'];
export const HOUSEHOLD_IDS = HOUSEHOLDS.map(h => h.id);

/** navigate_page の params（ページ固有の条件）。全部任意。移動先に関係ない項目は無視する */
export interface NavParams {
  /** 概算要求・租税特別措置: 検索語 */
  q?: unknown;
  /** 概算要求: 府省名（完全一致） */
  ministry?: unknown;
  /** 租税特別措置: 適用年度 */
  year?: unknown;
  /** 租税特別措置: RS との関連を確認済みの制度だけ */
  linkedOnly?: unknown;
  /** 租税特別措置: amount / assessment / measures。国民負担: curve / revenue / stats / age / heatmap */
  view?: unknown;
  /** 国民負担: 年収（円） */
  income?: unknown;
  /** 国民負担: 世帯の型 */
  household?: unknown;
  /** 国民負担: 年齢 */
  age?: unknown;
  /** 国民負担: 消費税の推計を含める */
  includeConsumption?: unknown;
  /** 財政余力: 政策と年額 */
  policies?: unknown;
}

/** 国民負担ページの条件を URL に写す。無効な値は既定のままにして warnings に残す */
export function taxBurdenSearch(params: NavParams): { search: string; warnings: string[] } {
  const state = initialTaxState();
  const warnings: string[] = [];
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);
  const income = int(params.income);
  if (params.income !== undefined) { if (income !== null && income >= 0 && income <= 20_000_000) state.income = income; else warnings.push('income は 0〜20,000,000 円の整数'); }
  const age = int(params.age);
  if (params.age !== undefined) { if (age !== null && age >= 20 && age <= 64) state.age = age; else warnings.push('age は 20〜64'); }
  if (params.household !== undefined) {
    if (typeof params.household === 'string' && (HOUSEHOLD_IDS as string[]).includes(params.household)) state.household = params.household as HouseholdId;
    else warnings.push(`household は ${HOUSEHOLD_IDS.join(' / ')}`);
  }
  if (params.includeConsumption !== undefined) {
    if (typeof params.includeConsumption === 'boolean') state.includeConsumption = params.includeConsumption; else warnings.push('includeConsumption は true / false');
  }
  if (params.view !== undefined) {
    if (typeof params.view === 'string' && TAX_BURDEN_VIEWS.includes(params.view as TaxView)) state.view = params.view as TaxView;
    else warnings.push(`view は ${TAX_BURDEN_VIEWS.join(' / ')}`);
  }
  return { search: encodeTaxState(state), warnings };
}

/** 財政余力の政策と年額を検証して amounts（政策 id → 円）にする */
export function fiscalScenarioAmounts(policies: unknown): { amounts: Record<string, number>; warnings: string[] } {
  const amounts: Record<string, number> = {};
  const warnings: string[] = [];
  if (!Array.isArray(policies)) return { amounts, warnings: policies === undefined ? [] : ['policies は [{ id, amountYen }] の配列'] };
  for (const item of policies.slice(0, FISCAL_POLICIES.length)) {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    const amount = item && typeof item === 'object' ? (item as { amountYen?: unknown }).amountYen : undefined;
    if (typeof id !== 'string' || !FISCAL_POLICIES.some(p => p.id === id)) { warnings.push(`policies.id は ${FISCAL_POLICIES.map(p => p.id).join(' / ')}`); continue; }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > FISCAL_POLICY_AMOUNT_MAX_YEN) { warnings.push(`${id} の amountYen は 0〜${FISCAL_POLICY_AMOUNT_MAX_YEN} 円`); continue; }
    amounts[id] = Math.round(amount);
  }
  return { amounts, warnings };
}

export interface NavDestination {
  href: string;
  /** 財政余力: クライアントが既定の条件に重ねて URL ハッシュへ符号化する政策の年額 */
  scenario?: { amounts: Record<string, number> };
  /** 受け付けなかった条件（LLM への返答に使う） */
  warnings: string[];
}

/** 移動先の URL を組み立てる。サンキー条件（query）はここでは扱わない（クライアントが result から組む） */
export function navTargetHref(target: NavTarget, params: NavParams | undefined): NavDestination {
  if (!params || typeof params !== 'object') return { href: target.href, warnings: [] };
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
  const q = new URLSearchParams();
  const warnings: string[] = [];
  switch (target.key) {
    case 'budget-requests': {
      if (str(params.q, 200)) q.set('q', str(params.q, 200));
      if (str(params.ministry, 100)) q.set('ministry', str(params.ministry, 100));
      break;
    }
    case 'tax-expenditures': {
      if (str(params.q, 200)) q.set('q', str(params.q, 200));
      if (params.year !== undefined) {
        const year = String(params.year);
        if ((TAX_EXPENDITURE_YEARS as readonly string[]).includes(year)) q.set('year', year); else warnings.push(`year は ${TAX_EXPENDITURE_YEARS.join(' / ')}`);
      }
      if (params.linkedOnly === true) q.set('linked', '1');
      if (params.view !== undefined) {
        if (typeof params.view === 'string' && (TAX_EXPENDITURE_VIEWS as readonly string[]).includes(params.view)) q.set('view', params.view);
        else warnings.push(`view は ${TAX_EXPENDITURE_VIEWS.join(' / ')}`);
      }
      break;
    }
    case 'tax-burden': {
      const built = taxBurdenSearch(params);
      return { href: `${target.href}?${built.search}`, warnings: built.warnings };
    }
    case 'fiscal-space': {
      const built = fiscalScenarioAmounts(params.policies);
      return { href: target.href, ...(Object.keys(built.amounts).length ? { scenario: { amounts: built.amounts } } : {}), warnings: built.warnings };
    }
    default:
      return { href: target.href, warnings: [] };
  }
  const search = q.toString();
  return { href: search ? `${target.href}?${search}` : target.href, warnings };
}
