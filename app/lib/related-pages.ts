/**
 * 事業ごとの「関連ページ」。RS や予算書では粒度が足りないとき、原資料を公表している省庁のページへ案内する。
 * 手で選んだ一覧で、確認済みの URL だけを載せる（取得・抽出はしない。リンク先の内容は各省庁の公表どおり）。
 *
 * 例: 社会資本整備総合交付金・防災・安全交付金は RS の支出先が上位 10 団体＋「その他」（76〜81%）にまとまるが、
 * 国交省 道路局は毎年 4 月に都道府県別の箇所表（市町村・工区ごとの想定国費）を公表している。
 */
export interface RelatedPage {
  /** 画面に出す短い名前（公表元を含める） */
  label: string;
  url: string;
  /** ホバーで出す説明。何が載っているか、RS との違い */
  note: string;
}

const ROAD_ALLOCATION: RelatedPage[] = [
  {
    label: '国交省 道路関係予算配分（都道府県別の箇所表）',
    url: 'https://www.mlit.go.jp/road/ir/ir-yosan/r8yhai.html',
    note: '令和8年度当初配分。都道府県ごとに、社会資本整備総合交付金・防災・安全交付金の道路分の想定国費を計画・工区・事業実施主体（市町村）別に、直轄・補助事業は箇所別に掲載。RS の支出先では「その他」にまとまる市町村別の配分が分かる',
  },
  {
    label: '国交省 社会資本総合整備事業関係 予算配分概要',
    url: 'https://www.mlit.go.jp/report/press/content/001994790.pdf',
    note: '令和8年度。社会資本整備総合交付金・防災・安全交付金の配分方針と都道府県別配分額（事業費・百万円）',
  },
];

/** 予算事業ID → 関連ページ */
const RELATED_PAGES: Record<string, RelatedPage[]> = {
  '4447': ROAD_ALLOCATION, // 国土交通省 社会資本整備総合交付金
  '4448': ROAD_ALLOCATION, // 国土交通省 防災・安全交付金
  '18692': ROAD_ALLOCATION, // 国土交通省 社会資本整備総合交付金（道路事業）
  '178': ROAD_ALLOCATION, // 内閣府 社会資本整備総合交付金（沖縄分。箇所表は沖縄県のページ）
  '179': ROAD_ALLOCATION, // 内閣府 防災・安全交付金（沖縄分）
};

export function relatedPagesFor(pid: string | number): RelatedPage[] {
  return RELATED_PAGES[String(pid)] ?? [];
}
