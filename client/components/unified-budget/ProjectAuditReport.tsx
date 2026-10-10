'use client';

/**
 * 事業の詳細パネルに出す「会計検査院の決算検査報告」。検査機関による指摘なので、AI評価（独自基準・試行）とは別の枠で出す。
 * 指摘と予算事業IDの対応は scripts/data/audit-report-matches.json（補助金・事業名と項の候補を確認して作成）
 */
import type { AuditReportItem } from '@/types/audit-report';
import { useCached } from './policy-summary-cache';

export const auditReportCache = new Map<string, AuditReportItem[] | null>();
const cache = auditReportCache;
export const extractAuditReportItems = (d: unknown) => (d as { items: AuditReportItem[] }).items;
const extract = extractAuditReportItems;

const KIND_LABEL: Record<string, string> = {
  不当事項: '不当事項',
  意見を表示し又は処置を要求した事項: '意見表示・処置要求',
  本院の指摘に基づき当局において改善の処置を講じた事項: '指摘に基づく改善処置',
};

/** 指摘額は1万円未満まで出ている公表値を、読みやすい桁に丸める */
const yenShort = (v: number) => (v >= 1e8 ? `${(v / 1e8).toFixed(1)}億円` : `${Math.max(1, Math.round(v / 1e4)).toLocaleString('ja-JP')}万円`);
/** 検査報告の見出しの通し番号「(12) 」「(1)(2)」は画面では外す */
const plainTitle = (t: string) => t.replace(/^(?:\(\d+\))+(?:―\(\d+\))?\s*/, '');

/** 指摘の一覧（本文）。詳細パネルの「外部の検査」のアコーディオンでも同じものを出す */
export function AuditReportList({ items, scaleFont }: { items: AuditReportItem[]; scaleFont: (px: number) => number }) {
  return <>
    <ul className="m-0 list-none space-y-1.5 p-0" style={{ fontSize: scaleFont(11) }}>
      {items.map(i => <li key={i.id}>
        <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent"
          title="検査報告データベース（会計検査院）を開く">{plainTitle(i.title)} ↗</a>
        <div className="text-mirai-text-muted">
          {i.era}決算検査報告・{KIND_LABEL[i.kind] ?? i.kind}
          {i.amount !== null && <span title={i.amountText ?? undefined}>・不当と認めた額 {yenShort(i.amount)}</span>}
        </div>
      </li>)}
    </ul>
    <p className="mt-1.5 text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>指摘の多くは特定の事業主体（［ ］内の県・事業者など）に対するもので、事業全体の評価ではありません。出典：会計検査院「決算検査報告」。事業との対応づけは本サイトで作成</p>
  </>;
}

/** padding は置き場所（サイドパネル px-3.5 / 評価一覧のダイアログ px-6）に合わせて渡す */
export function ProjectAuditReport({ pid, scaleFont, padding = 'px-3.5 py-2.5' }: { pid: number; scaleFont: (px: number) => number; padding?: string }) {
  const items = useCached(cache, String(pid), `/api/audit-report?pid=${pid}`, extract);
  if (!items || items.length === 0) return null;
  return <section aria-label="会計検査院の決算検査報告" className={`border-b border-border ${padding}`}>
    <div className="mb-1 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>
      決算検査報告<span className="ml-1.5 font-normal text-mirai-text-muted" style={{ fontSize: scaleFont(11) }}>会計検査院による指摘・{items.length}件</span>
    </div>
    <AuditReportList items={items} scaleFont={scaleFont} />
  </section>;
}
