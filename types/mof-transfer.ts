/**
 * MOF一般会計・特別会計繰入の詳細型定義
 */

/**
 * 一般会計から特別会計への繰入詳細
 */
export interface TransferFromGeneralAccount {
  /** 実質的な繰入総額（国債整理基金除く、円単位） */
  total: number;

  /** 繰入総額（国債整理基金含む、参考値、円単位） */
  totalIncludingDebt: number;

  /** 個別特会への配分 */
  breakdown: {
    /** 年金特別会計への繰入 */
    pension: {
      total: number;
      details: {
        basicPension: number;          // 基礎年金
        nurseryBenefit: number;        // 子どものための教育・保育給付
        childAllowance: number;        // 児童手当
        pensionAdministration: number; // 年金制度関連その他
      };
    };

    /** 交付税及び譲与税配付金特別会計への繰入 */
    localAllocationTax: {
      total: number;
      details: {
        generalTransfer: number;       // 一般交付税交付金
        specialTransfer: number;       // 地方特例交付金
        trafficViolationFund: number;  // 交通反則者納金財源
      };
    };

    /** 国債整理基金特別会計への繰入（別枠参考値） */
    debtRetirement: {
      total: number;
      details: {
        ordinaryBondRedemption: number;  // 普通国債等償還財源
        pensionBondRedemption: number;   // 年金特例公債償還財源
        investmentBondRedemption: number; // 出資国債等償還財源
      };
    };

    /** エネルギー対策特別会計への繰入 */
    energy: {
      total: number;
      details: {
        petroleumCoalTax: number;      // 石油石炭税財源
        powerDevelopmentTax: number;   // 電源開発促進税財源
      };
    };

    /** 食料安定供給特別会計への繰入 */
    foodSupply: number;

    /** 労働保険特別会計への繰入 */
    laborInsurance: number;

    /** 自動車安全特別会計への繰入 */
    automotiveSafety: number;

    /** 東日本大震災復興特別会計への繰入 */
    reconstruction: number;

    /** 国有林野事業債務管理特別会計への繰入 */
    forestryDebtManagement: number;

    /** 特許特別会計への繰入 */
    patent: number;
  };
}

/**
 * 社会保険料の特別会計別配分
 */
export interface InsurancePremiumAllocation {
  total: number;

  breakdown: {
    /** 年金特別会計（年金保険料） */
    pension: number;

    /** 労働保険特別会計（労働保険料） */
    labor: number;

    /** その他特別会計（健康保険料等） */
    other: number;
  };
}

/**
 * 特別会計間の繰入詳細
 */
export interface TransferBetweenSpecialAccounts {
  total: number;

  /** 主要な繰入フロー */
  majorFlows: Array<{
    from: string;          // 繰入元特別会計
    to: string;            // 繰入先特別会計
    amount: number;        // 金額（円）
    purpose: string;       // 目的・用途
  }>;
}
