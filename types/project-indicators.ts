/**
 * 事業の成果目標・実績（RS 3-1 効果発現経路_目標・実績）の UI 用データ。
 *
 * 生成: scripts/generate-project-outcomes.py（rs{YEAR}-project-indicators.json）
 * 配信: /api/project-indicators/[projectId]?year=
 *
 * 同スクリプトが出す rs{YEAR}-project-outcomes.json は点検・ロジックモデル込みの AI 採点用で
 * 50MB 超のためサーバー関数には同梱しない。画面が読むのはこちらの軽量版だけ。
 */

/** 指標の種別（ロジックモデル上の段階） */
export type IndicatorKind = 'アクティビティ' | 'アウトプット' | 'アウトカム' | string;

/** 年度 → 値（文字列のまま。小数・カンマ無しの数値文字列） */
export type YearSeries = Record<string, string>;

export interface ProjectIndicator {
  /** 指標番号（101, 201, 301 ...。百の位が段階を表す） */
  no: string;
  kind: IndicatorKind;
  /** アウトカムの期間: '1.短期' | '2.中期' | '3.長期' | ''（アウトカム以外は空） */
  period: string;
  /** '定量的' | '定性的' | '' */
  goalType: string;
  /** 活動目標／成果目標の文章 */
  goal: string;
  /** 指標名（未設定は '' または '--'） */
  indicator: string;
  unit: string;
  /** '上がると良い指標' | '下がると良い指標' | '' */
  direction: string;
  /** 指標の出典・データソース */
  source: string;
  /** 定性的な指標の実績（文章） */
  qualitativeResult: string;
  /** 年度ごとの目標値・実績値・達成率（%）。直近 6 年度ぶん */
  target: YearSeries;
  actual: YearSeries;
  rate: YearSeries;
}

export interface ProjectIndicators {
  indicators: ProjectIndicator[];
}

/** Key: 予算事業ID（文字列）。指標が 1 つも無い事業は載らない */
export type ProjectIndicatorsData = Record<string, ProjectIndicators>;

/** /api/project-indicators/[projectId] の応答 */
export interface ProjectIndicatorsResponse extends ProjectIndicators {
  pid: string;
  /** 参照した RS シートの年度 */
  sheetYear: number;
}
