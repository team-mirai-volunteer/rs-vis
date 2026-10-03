/** 支出先（法人番号）に突き合わせた外部情報。生成は scripts/generate-recipient-external.ts */
export interface RecipientExternal {
  /** 所在地（RS公開APIの支払先） */
  ad?: string;
  /** 法人種別コード（国税庁の法人番号の種別。101=国の機関、201=地方公共団体、301=株式会社 など） */
  k?: string;
  /** Wikidata の項目ID（Q…） */
  wd?: string;
  /** Wikidata の名称 */
  label?: string;
  /** Wikidata の説明文 */
  desc?: string;
  /** 公式サイト（Wikidata P856） */
  site?: string;
  /** 日本語版 Wikipedia の記事 URL */
  wiki?: string;
  /** その記事のリード文の冒頭（1〜2文。CC BY-SA 4.0。表示では出典と記事へのリンクを添える） */
  wt?: string;
  /** 設立・成立日（Wikidata P571。YYYY-MM-DD。精度は年単位のこともある） */
  since?: string;
}

export interface RecipientExternalFile {
  metadata: { generatedAt: string; corporateNumbers: number; sources: string[] };
  byCn: Record<string, RecipientExternal>;
}
