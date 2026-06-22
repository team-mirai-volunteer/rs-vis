/**
 * API応答に埋め込む関連リンク（HATEOAS）の組み立て。
 * すべて相対URLで返し、ホスト名に依存しない。
 */
import { isValidCorporateNumber } from '@/app/lib/recipient-key';

export function projectLinks(pid: string | number, year?: string): {
  detail: string;
  subcontracts: string;
  qualityRecipients: string;
  web: string;
} {
  const y = year ? `?year=${year}` : '';
  const yAmp = year ? `&year=${year}` : '';
  return {
    detail: `/api/project-details/${pid}${y}`,
    subcontracts: `/api/subcontracts/${pid}${y}`,
    qualityRecipients: `/api/quality-scores/recipients?pid=${pid}${yAmp}`,
    web: `/subcontracts/${pid}${y}`,
  };
}

export function recipientLinks(key: string, year?: string): {
  recipient: string;
} {
  const y = year ? `?year=${year}` : '';
  const encoded = encodeURIComponent(key);
  return {
    recipient: `/api/recipients/${encoded}${y}`,
  };
}

/**
 * /sankey-svg の名前フィルタ（既存機能）へのディープリンク。
 * fnp=事業名フィルタ, fnr=支出先名フィルタ, fp=1 でフィルタパネルを開く。
 */
export function sankeyProjectViewLink(projectName: string, year?: string): string {
  const yr = year ? `&yr=${year}` : '';
  return `/sankey-svg?fnp=${encodeURIComponent(projectName)}&fp=1${yr}`;
}

export function sankeyRecipientViewLink(recipientName: string, year?: string): string {
  const yr = year ? `&yr=${year}` : '';
  return `/sankey-svg?fnr=${encodeURIComponent(recipientName)}&fp=1${yr}`;
}

/** 法人番号から外部サイト（gBizINFO）へのリンク */
export function externalCorporateLinks(corporateNumber: string): { gbizinfo: string } | undefined {
  const cn = corporateNumber.trim();
  if (!isValidCorporateNumber(cn)) return undefined;
  return {
    gbizinfo: `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${cn}`,
  };
}
