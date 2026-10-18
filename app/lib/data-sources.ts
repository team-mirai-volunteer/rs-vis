/**
 * 本サービスが用いる公開データの出典一覧。
 * 利用規約 第6条（app/terms/page.tsx）と LP の「出典と利用条件」（app/lp/page.tsx）で共用する。
 * 公共データ利用規約（PDL1.0）が求める「出典の個別表示と URL の記載」をここで満たすので、
 * データの公開元を増減したときは必ずこの一覧を更新する（利用条件の確認日 2026-10-08、法務確認 2026-10-19）。
 */
export type DataSource = {
  /** 公開元の名称（出典表示に用いる） */
  name: string;
  /** 公開元の URL（出典表示に用いる） */
  href: string;
  /** 公開元の利用規約のページ（公開元の名称と異なる場所にある場合のみ） */
  termsHref?: string;
  /** 公開元が定める利用条件と、本サービスでの表示方法 */
  terms: string;
};

export const DATA_SOURCES: readonly DataSource[] = [
  { name: '行政事業レビュー見える化サイト（内閣官房・RSシステム）', href: 'https://rssystem.go.jp/', termsHref: 'https://rssystem.go.jp/terms', terms: 'レビューシート・基金シート・セグメントシート・公開API。公共データ利用規約（PDL1.0）。出典「行政事業レビュー見える化サイト」を明記し、編集・加工した旨を表示' },
  { name: '財務省 予算書・決算書データベース', href: 'https://www.bb.mof.go.jp/', terms: '政府標準利用規約（第2.0版）。出典を明記し、編集・加工した旨を表示' },
  { name: '会計検査院 検査報告データベース', href: 'https://report.jbaudit.go.jp/', terms: '政府標準利用規約（PDL1.0相当）。出典「会計検査院Webサイト」、加工時は明記' },
  { name: '財務省 予算執行調査', href: 'https://www.mof.go.jp/policy/budget/topics/budget_execution_audit/', terms: '政府標準利用規約（PDL1.0相当）。出典を明記' },
  { name: '財務省 租税特別措置の適用実態調査', href: 'https://www.mof.go.jp/tax_policy/reference/stm_report/', terms: '政府標準利用規約。原表Excelの行番号と原本のハッシュを保持' },
  { name: '総務省 家計調査（e-Stat 政府統計の総合窓口）', href: 'https://www.e-stat.go.jp/', terms: '政府統計の総合窓口の利用規約。出典を明記' },
  { name: '国税庁 法人番号公表サイト／Wikidata／Wikipedia', href: 'https://www.houjin-bangou.nta.go.jp/', terms: '法人番号は公表情報。Wikidata は CC0、Wikipedia の冒頭文は CC BY-SA 4.0 で出典とリンクを表示' },
];

/** 公共データ利用規約（PDL1.0）の原文（デジタル庁） */
export const PUBLIC_DATA_LICENSE_URL = 'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0';
