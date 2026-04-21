/**
 * View State Types
 *
 * Sankeyページの状態管理を統合するための型定義
 */

/**
 * ビューモード
 */
export type ViewMode = 'global' | 'ministry' | 'project' | 'spending';

/**
 * ビュー状態
 *
 * ナビゲーション関連の状態を統合
 */
export interface ViewState {
  /** 現在のビューモード */
  mode: ViewMode;
  /** 選択中の府省庁名 */
  selectedMinistry: string | null;
  /** 選択中の事業名 */
  selectedProject: string | null;
  /** 選択中の支出先名 */
  selectedRecipient: string | null;
  /** 府省庁ドリルダウンレベル（全体ビュー） */
  drilldownLevel: number;
  /** 事業ドリルダウンレベル（府省庁・支出ビュー） */
  projectDrilldownLevel: number;
  /** 支出先ドリルダウンレベル（全体ビュー） */
  spendingDrilldownLevel: number;
}

/**
 * TopN設定
 *
 * 各ビューでのTopN表示数を統合
 */
export interface TopNSettings {
  /** 全体ビュー設定 */
  global: {
    /** 府省庁TopN */
    ministry: number;
    /** 支出先TopN */
    spending: number;
    /** 再委託先TopN */
    subcontract: number;
  };
  /** 府省庁ビュー設定 */
  ministry: {
    /** 事業TopN */
    project: number;
    /** 支出先TopN */
    spending: number;
  };
  /** 事業ビュー設定 */
  project: {
    /** 支出先TopN */
    spending: number;
  };
  /** 支出ビュー設定 */
  spending: {
    /** 支出元事業TopN */
    project: number;
    /** 支出元府省庁TopN */
    ministry: number;
    /** 再委託先TopN */
    subcontract: number;
  };
}

/**
 * ダイアログ状態
 *
 * 各種モーダル・ダイアログの開閉状態を統合
 */
export interface DialogStates {
  /** 設定ダイアログ */
  settings: boolean;
  /** サマリーダイアログ */
  summary: boolean;
  /** 事業一覧モーダル */
  projectList: boolean;
  /** 支出先一覧モーダル */
  spendingList: boolean;
  /** 再委託先詳細モーダル */
  subcontractDetail: boolean;
}

/**
 * デフォルトのViewState
 */
export const DEFAULT_VIEW_STATE: ViewState = {
  mode: 'global',
  selectedMinistry: null,
  selectedProject: null,
  selectedRecipient: null,
  drilldownLevel: 0,
  projectDrilldownLevel: 0,
  spendingDrilldownLevel: 0,
};

/**
 * デフォルトのTopNSettings
 */
export const DEFAULT_TOPN_SETTINGS: TopNSettings = {
  global: {
    ministry: 10,
    spending: 10,
    subcontract: 5,
  },
  ministry: {
    project: 10,
    spending: 10,
  },
  project: {
    spending: 20,
  },
  spending: {
    project: 15,
    ministry: 10,
    subcontract: 20,
  },
};

/**
 * デフォルトのDialogStates
 */
export const DEFAULT_DIALOG_STATES: DialogStates = {
  settings: false,
  summary: false,
  projectList: false,
  spendingList: false,
  subcontractDetail: false,
};
