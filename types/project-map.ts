/**
 * 事業の意味的2次元マップ（/project-map のバブルチャート）の型。
 *
 * 座標とクラスタは scripts/generate-project-map.py が生成した
 * public/data/project-map-{year}.json に入っている。
 * 金額・スコア・府省庁は品質スコア側にあり、API で pid 結合してから返す。
 */

/** 生成物 public/data/project-map-{year}.json の形 */
export interface ProjectMapFile {
  year: number;
  /** 埋め込みに使ったモデル（例: google/gemini-embedding-001） */
  model: string;
  generatedAt: string;
  params: {
    neighbors: number;
    minDist: number;
    clusters: number;
    seed: number;
    maxChars: number;
  };
  quality: {
    /** KMeansクラスタと policyCategory の一致度。マップの妥当性の目安 */
    kmeansAriVsPolicyCategory: number;
  };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  clusters: ProjectMapCluster[];
  points: Array<{ pid: string; x: number; y: number; c: number }>;
}

export interface ProjectMapCluster {
  id: number;
  count: number;
  /** ラベルを置く2D重心 */
  cx: number;
  cy: number;
  /** 構成事業の最頻 policyCategory。表示名は POLICY_CATEGORY_LABELS で引く */
  dominantCategory: string;
  /** 最頻カテゴリの占有率 0-1。低いほど雑多なクラスタ */
  categoryShare: number;
  /** 特徴語（そのクラスタに偏って出る語） */
  terms: string[];
  representativePid: string;
  representativeName: string;
  topMinistries: string[];
}

/** バブル1つ分。描画に要るものだけを持つ */
export interface ProjectMapPoint {
  pid: string;
  name: string;
  ministry: string;
  /** UMAP座標 */
  x: number;
  y: number;
  /** クラスタid */
  c: number;
  /** 歳出予算現額（円） */
  budget: number;
  /** 執行額（円） */
  exec: number;
  /** 政策評価の総合点 0-100。未評価は null */
  score: number | null;
  /** 費用対内容 0-100。未評価は null */
  prop: number | null;
  /** 必要性 0-100。未評価は null */
  nec: number | null;
  /** 継続年数。開始年度不明は null */
  years: number | null;
  /** policyCategory の id */
  cat: string | null;
  /** 推奨判断（継続 / 要改善 / … / 終了・廃止候補） */
  rec: string | null;
}

export interface ProjectMapResponse {
  year: number;
  model: string;
  generatedAt: string;
  quality: ProjectMapFile['quality'];
  bounds: ProjectMapFile['bounds'];
  clusters: ProjectMapCluster[];
  points: ProjectMapPoint[];
  summary: {
    /** マップに載った事業数 */
    total: number;
    /** 事業数の多い順の府省庁。凡例の色割り当てはこの順に従う */
    ministries: Array<{ name: string; count: number }>;
    /** 総合点が付いている事業数 */
    scored: number;
  };
}

/**
 * 支出つながりビュー（/project-bubble の「支出」重畳）の支出先1件。
 * 事業マップ上の事業から支出を受けている支出先（匿名・集約表記は除く）。
 * 2事業以上に繋がるものが事業同士を結ぶ。1事業だけのものも大口を見せるために持つ。
 */
export interface ProjectMapSpendingRecipient {
  /** sankey-svg グラフの recipient ノード id（例: r-123） */
  id: string;
  name: string;
  /** マップ上の事業からの支出の合計（円） */
  amount: number;
  /** 支出元の事業 pid。amounts と同じ並び・金額の大きい順 */
  pids: string[];
  /** 各事業からの支出額（円） */
  amounts: number[];
}

export interface ProjectMapSpendingResponse {
  year: number;
  /** 金額の大きい順 */
  recipients: ProjectMapSpendingRecipient[];
  summary: {
    recipients: number;
    links: number;
    /** 名前が匿名・集約表記のため除外した支出先の数（「その他」「個人A」など） */
    excludedPlaceholders: number;
  };
}
