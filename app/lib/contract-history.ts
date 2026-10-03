/**
 * 支出先の契約方式を3つのシート年度（RS公開API 2024・2025・2026）で並べる（Pure 層）。
 *
 * 支出先インデックスはシート年度ごとに別物なので、年度をまたぐ突き合わせは法人番号で行う
 * （番号が無い相手だけ表記ゆれ（aliases）の名前で拾う）。事業ID（pid）は継続事業なら年度をまたいで同じ。
 * 「同じ事業で随意契約が続いているもの」は確認の手がかりであって、不適切さの判定ではない。
 * シート2024は元データの約14%の契約に方式が無く、生成時に落ちている。無い年度は「不明」であって競争入札ではない。
 */
import { contractCategory, totalsByCategory, type CategoryTotal, type ContractCategory, type ContractMethodEntry,
  type ContractMethodsByPid } from '@/app/lib/contract-method';
import { normalizeRecipientName } from '@/app/lib/recipient-key';

export const HISTORY_SHEET_YEARS = ['2024', '2025', '2026'] as const;
export type HistorySheetYear = (typeof HISTORY_SHEET_YEARS)[number];

/**
 * 実績年度の表示。RS公開APIのシート2026は2025年度の執行（公開途中のため暫定）。
 * （他画面の「2026年度（要求）」= シート2025の要求額とは別物なので rs-fiscal-year の fiscalYearLabel は使わない）
 */
export const historyYearLabel = (sheetYear: string) => `${Number(sheetYear) - 1}年度${sheetYear === '2026' ? '（暫定）' : ''}`;

/** 「随意契約が続いている」と数える区分。少額随契は入札を省くのが通常なので除く */
const NEGOTIATED: ReadonlySet<ContractCategory> = new Set(['negotiated-sole', 'negotiated-competitive']);

export interface ContractHistoryYear {
  sheetYear: string;
  /** その年度の契約方式ファイルがあるか */
  available: boolean;
  /** 区分ごとの集計（金額の大きい順） */
  methods: CategoryTotal[];
  count: number;
  singleBidder: number;
}

export interface ContinuingProjectYear {
  sheetYear: string;
  /** 随意契約（競争なし）の金額（円。非公表を除く）・件数 */
  soleAmount: number;
  soleCount: number;
  /** 随意契約（企画競争・公募）の金額・件数 */
  negotiatedCompetitiveAmount: number;
  negotiatedCompetitiveCount: number;
  /** それ以外（入札・国庫債務負担行為・少額随契・補助金等）の金額・件数 */
  otherAmount: number;
  otherCount: number;
  /** 随意契約のうち応札・応募者数が1者だった件数 */
  singleBidder: number;
  /** その年度の契約方式データにこの事業があるか（無ければ事業が無い・未公開） */
  projectListed: boolean;
}

export interface ContinuingNegotiatedProject {
  pid: string;
  name?: string;
  ministry?: string;
  years: ContinuingProjectYear[];
  /** 随意契約（競争なし・企画競争・公募）があった年度の数 */
  negotiatedYears: number;
  /** 少額以外の契約があった年度すべてで、それがすべて随意契約（競争なし） */
  allSole: boolean;
  /** 3年度の随意契約（競争なし・企画競争・公募）の金額の合計。並び順に使う */
  negotiatedAmount: number;
}

export interface ContractHistory {
  years: ContractHistoryYear[];
  /** 随意契約の金額の大きい順に上位 limit 件 */
  continuing: ContinuingNegotiatedProject[];
  /** 該当事業の総数（continuing は上位だけ） */
  continuingCount: number;
  /** うち毎年すべて競争なしの随意契約の事業数 */
  continuingAllSoleCount: number;
}

export const CONTINUING_LIMIT = 10;

/**
 * @param corporateNumber 13桁。空なら aliases の名前だけで拾う
 * @param projectInfo 事業名・府省の引き当て（無ければ pid だけ返す）
 * @returns 番号も名前も無ければ null
 */
export function buildContractHistory(corporateNumber: string, aliases: readonly string[],
  methodsByYear: Partial<Record<string, ContractMethodsByPid | null>>,
  projectInfo: (pid: string) => { name: string; ministry?: string } | undefined = () => undefined,
  limit = CONTINUING_LIMIT): ContractHistory | null {
  const cn = /^\d{13}$/.test(corporateNumber) ? corporateNumber : '';
  const names = new Set(aliases.map(normalizeRecipientName).filter(Boolean));
  if (!cn && names.size === 0) return null;
  const mine = (c: ContractMethodEntry) => cn
    ? c.cn === cn || (!c.cn && names.has(normalizeRecipientName(c.n)))
    : names.has(normalizeRecipientName(c.n));

  const years: ContractHistoryYear[] = [];
  /** pid → シート年度 → この支出先の契約 */
  const byPid = new Map<string, Map<string, ContractMethodEntry[]>>();
  for (const sheetYear of HISTORY_SHEET_YEARS) {
    const file = methodsByYear[sheetYear];
    const all: ContractMethodEntry[] = [];
    for (const [pid, entries] of Object.entries(file ?? {})) {
      const hit = entries.filter(mine);
      if (hit.length === 0) continue;
      all.push(...hit);
      const m = byPid.get(pid) ?? new Map<string, ContractMethodEntry[]>();
      m.set(sheetYear, hit);
      byPid.set(pid, m);
    }
    years.push({ sheetYear, available: !!file, methods: totalsByCategory(all), count: all.length, singleBidder: all.filter(e => e.ap === 1).length });
  }

  const continuing: ContinuingNegotiatedProject[] = [];
  for (const [pid, perYear] of byPid) {
    const negotiatedYears = [...perYear.values()].filter(es => es.some(e => NEGOTIATED.has(contractCategory(e.m)))).length;
    if (negotiatedYears < 2) continue;
    const projYears = HISTORY_SHEET_YEARS.map((sheetYear): ContinuingProjectYear => {
      const y: ContinuingProjectYear = { sheetYear, soleAmount: 0, soleCount: 0, negotiatedCompetitiveAmount: 0, negotiatedCompetitiveCount: 0,
        otherAmount: 0, otherCount: 0, singleBidder: 0, projectListed: !!methodsByYear[sheetYear]?.[pid] };
      for (const e of perYear.get(sheetYear) ?? []) {
        const category = contractCategory(e.m);
        if (category === 'negotiated-sole') { y.soleAmount += e.a ?? 0; y.soleCount++; }
        else if (category === 'negotiated-competitive') { y.negotiatedCompetitiveAmount += e.a ?? 0; y.negotiatedCompetitiveCount++; }
        else { y.otherAmount += e.a ?? 0; y.otherCount++; }
        if (NEGOTIATED.has(category) && e.ap === 1) y.singleBidder++;
      }
      return y;
    });
    const allSole = [...perYear.values()].every(es => es.every(e => ['negotiated-sole', 'negotiated-small'].includes(contractCategory(e.m))));
    continuing.push({ pid, years: projYears, negotiatedYears, allSole,
      negotiatedAmount: projYears.reduce((s, y) => s + y.soleAmount + y.negotiatedCompetitiveAmount, 0) });
  }
  continuing.sort((a, b) => b.negotiatedAmount - a.negotiatedAmount || Number(a.pid) - Number(b.pid));
  return {
    years,
    continuing: continuing.slice(0, limit).map(p => {
      const info = projectInfo(p.pid);
      return info ? { ...p, name: info.name, ...(info.ministry ? { ministry: info.ministry } : {}) } : p;
    }),
    continuingCount: continuing.length,
    continuingAllSoleCount: continuing.filter(p => p.allSole).length,
  };
}
