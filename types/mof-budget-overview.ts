/**
 * MOF予算全体ビューの型定義
 */

import type { SankeyNode, SankeyLink } from './sankey';
import type {
  TransferFromGeneralAccount,
  InsurancePremiumAllocation,
  TransferBetweenSpecialAccounts,
} from './mof-transfer';

/**
 * MOF予算全体ビューのノード種別
 */
export type MOFBudgetNodeType =
  | 'tax-detail' // 税目別（消費税、所得税等）
  | 'public-bonds' // 公債金
  | 'insurance-premium' // 社会保険料
  | 'other-revenue' // その他収入
  | 'account-type' // 会計区分（一般/特別）
  | 'rs-category' // RS対象区分
  | 'budget-detail' // 詳細内訳
  | 'rs-summary' // RS集約
  | 'other'; // その他

/**
 * 税目の種類
 */
export type TaxType =
  | '消費税'
  | '所得税'
  | '法人税'
  | '相続税'
  | '揮発油税'
  | '酒税'
  | '関税'
  | 'たばこ税'
  | '石油石炭税'
  | '自動車重量税'
  | '電源開発促進税'
  | 'その他税';

/**
 * MOF予算全体ビューのノード詳細
 */
export interface MOFBudgetNodeDetails {
  // 税目別ノード
  taxType?: TaxType;
  taxRate?: number; // 税率（該当する場合）

  // 保険料ノード
  insuranceType?: '年金保険料' | '労働保険料' | 'その他保険料';

  // 会計区分ノード
  accountType?: '一般会計' | '特別会計';
  rsTargetAmount?: number; // RS対象額（円）
  rsExcludedAmount?: number; // RS対象外額（円）
  rsTargetRate?: number; // RS対象率（%）

  // RS対象区分ノード
  category?: 'RS対象' | 'RS対象外';
  parentAccount?: '一般会計' | '特別会計';

  // 詳細内訳ノード
  detailType?:
  | '国債費'
  | '地方交付税'
  | '国債整理基金'
  | '地方交付税配付金'
  | '財政投融資'
  | '年金給付等'
  | '年金事業'
  | '労働保険'
  | '一般会計事業'
  | 'その他事業'
  | 'その他';
  isRSTarget?: boolean; // RS対象かどうか

  // 共通
  description?: string; // 説明文
  sourceType?: string; // 財源種別
  amount?: number; // 金額（円）
}

/**
 * MOF予算全体ビューのサンキーデータ
 */
export interface MOFBudgetOverviewData {
  metadata: {
    generatedAt: string;
    fiscalYear: number;
    totalBudget: number; // MOF予算総額（円）
    rsTargetBudget: number; // RS対象予算（円）
    rsExcludedBudget: number; // RS対象外予算（円）
    dataSource: string;
    notes: string[]; // 重要な注記
  };
  sankey: {
    nodes: (SankeyNode & { details?: MOFBudgetNodeDetails })[];
    links: SankeyLink[];
  };
  summary: {
    generalAccount: {
      total: number; // 合計（円）
      rsTarget: number; // RS対象（円）
      rsExcluded: number; // RS対象外（円）
      rsTargetRate: number; // RS対象率（%）
    };
    specialAccount: {
      total: number;
      rsTarget: number;
      rsExcluded: number;
      rsTargetRate: number;
    };
    overall: {
      total: number;
      rsTarget: number;
      rsExcluded: number;
      rsTargetRate: number;
    };
  };
}

/**
 * MOF予算データ（元データ）
 */
export interface MOFBudgetData {
  fiscalYear: number;
  dataType: 'budget' | 'settlement';

  // 一般会計
  generalAccount: {
    total: number;
    revenue: {
      // 租税詳細
      taxes: {
        consumptionTax: number; // 消費税
        incomeTax: number; // 所得税
        corporateTax: number; // 法人税
        inheritanceTax: number; // 相続税
        gasolineTax: number; // 揮発油税
        sakeTax: number; // 酒税
        customsDuty: number; // 関税
        tobaccoTax: number; // たばこ税
        petroleumCoalTax: number; // 石油石炭税
        automobileWeightTax: number; // 自動車重量税
        powerDevelopmentTax: number; // 電源開発促進税
        otherTaxes: number; // その他
        total: number; // 租税合計
      };
      publicBonds: number; // 公債金
      stampRevenue: number; // 印紙収入
      otherRevenue: number; // その他収入
      total: number; // 歳入合計
    };
    expenditure: {
      rsTarget: number; // RS対象
      debtService: number; // 国債費
      localAllocationTax: number; // 地方交付税
      reserves: number; // 予備費等
      total: number; // 歳出合計
    };
  };

  // 特別会計
  specialAccount: {
    total: number;
    revenue: {
      // 社会保険料（シンプル版または詳細版）
      insurancePremiums:
        | {
            pension: number; // 年金保険料
            labor: number; // 労働保険料
            other: number; // その他保険料
            total: number; // 保険料合計
          }
        | InsurancePremiumAllocation; // 詳細版（将来実装）

      // 一般会計繰入（総額のみまたは詳細版）
      transferFromGeneral: number | TransferFromGeneralAccount;

      // 特別会計間繰入（総額のみまたは詳細版）
      transferFromOther: number | TransferBetweenSpecialAccounts;

      publicBonds: number; // 公債金（借換債）
      other: number; // その他
      total: number; // 歳入合計
    };
    // 歳出を詳細化
    expenditure: {
      // 特別会計ごとの詳細（年金・労働・エネルギー等）
      accounts: {
        pension: { total: number; rsTarget: number; rsExcluded: number }; // 年金特会
        labor: { total: number; rsTarget: number; rsExcluded: number }; // 労働保険特会
        energy: { total: number; rsTarget: number; rsExcluded: number }; // エネルギー対策特会
        food: { total: number; rsTarget: number; rsExcluded: number }; // 食料安定供給特会
        reconstruction: { total: number; rsTarget: number; rsExcluded: number }; // 東日本大震災復興特会
        forex: { total: number; rsTarget: number; rsExcluded: number }; // 外国為替資金特会
        debtRetirement: { total: number; rsTarget: number; rsExcluded: number }; // 国債整理基金特会
        allocationTax: { total: number; rsTarget: number; rsExcluded: number }; // 交付税配付金特会
        filp: { total: number; rsTarget: number; rsExcluded: number }; // 財政投融資特会
        others: { total: number; rsTarget: number; rsExcluded: number }; // その他特会
      };

      // 集計用（互換性維持のため残すが、詳細から算出も可能）
      rsTarget: {
        total: number; // RS対象合計
      };
      rsExcluded: {
        total: number; // RS対象外合計
      };
      total: number; // 歳出合計
    };
  };
}
