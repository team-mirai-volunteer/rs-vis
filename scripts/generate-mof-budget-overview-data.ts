#!/usr/bin/env npx ts-node
/**
 * MOF予算全体ビュー用データ生成スクリプト
 *
 * 財務省の2023年度予算データからMOF予算全体ビュー用のデータを生成する
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { MOFBudgetData } from '@/types/mof-budget-overview';
import type { TransferFromGeneralAccount } from '@/types/mof-transfer';
import { parseMOFTransferData } from './parse-mof-transfer-data';

// ES Module用のディレクトリ取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 出力先
const OUTPUT_FILE = path.join(
  __dirname,
  '../public/data/mof-budget-overview-2023.json'
);

/**
 * パースした繰入データから詳細構造を構築
 */
function buildTransferFromGeneral(): TransferFromGeneralAccount {
  const transferData = parseMOFTransferData();
  const transfers = transferData.generalToSpecial;

  // 特別会計別に集計
  const byAccount = new Map<string, number>();
  for (const t of transfers) {
    const current = byAccount.get(t.specialAccount) || 0;
    byAccount.set(t.specialAccount, current + t.amount * 1000); // 千円 → 円
  }

  // 年金特会の詳細（項目名から推定）
  const pensionDetails = {
    basicPension: 12_200_000_000_000, // 基礎年金
    nurseryBenefit: 1_374_000_000_000, // 保育給付
    childAllowance: 1_029_000_000_000, // 児童手当
    pensionAdministration: 497_000_000_000, // その他
  };
  const pensionTotal = Object.values(pensionDetails).reduce((sum, val) => sum + val, 0);

  // 交付税の詳細
  const localTaxDetails = {
    generalTransfer: 16_182_000_000_000, // 一般交付税
    specialTransfer: 217_000_000_000, // 地方特例交付金
    trafficViolationFund: 52_000_000_000, // 交通反則者納金財源
  };
  const localTaxTotal = Object.values(localTaxDetails).reduce((sum, val) => sum + val, 0);

  // 国債整理基金の詳細
  const debtDetails = {
    ordinaryBondRedemption: 24_764_000_000_000, // 普通国債等償還
    pensionBondRedemption: 272_000_000_000, // 年金特例公債償還
    investmentBondRedemption: 213_000_000_000, // 出資国債等償還
  };
  const debtTotal = Object.values(debtDetails).reduce((sum, val) => sum + val, 0);

  // エネルギー対策の詳細
  const energyDetails = {
    petroleumCoalTax: 520_000_000_000, // 石油石炭税財源
    powerDevelopmentTax: 293_000_000_000, // 電源開発促進税財源
  };
  const energyTotal = Object.values(energyDetails).reduce((sum, val) => sum + val, 0);

  const totalExcludingDebt = pensionTotal + localTaxTotal + energyTotal +
    (byAccount.get('食料安定供給') || 0) +
    (byAccount.get('労働保険') || 0) +
    (byAccount.get('自動車安全') || 0) +
    (byAccount.get('東日本大震災復興') || 0) +
    (byAccount.get('国有林野事業債務管理') || 0) +
    (byAccount.get('特許') || 0);

  return {
    total: totalExcludingDebt,
    totalIncludingDebt: totalExcludingDebt + debtTotal,
    breakdown: {
      pension: {
        total: pensionTotal,
        details: pensionDetails,
      },
      localAllocationTax: {
        total: localTaxTotal,
        details: localTaxDetails,
      },
      debtRetirement: {
        total: debtTotal,
        details: debtDetails,
      },
      energy: {
        total: energyTotal,
        details: energyDetails,
      },
      foodSupply: byAccount.get('食料安定供給') || 315_000_000_000,
      laborInsurance: byAccount.get('労働保険') || 35_000_000_000,
      automotiveSafety: byAccount.get('自動車安全') || 33_000_000_000,
      reconstruction: byAccount.get('東日本大震災復興') || 30_000_000_000,
      forestryDebtManagement: byAccount.get('国有林野事業債務管理') || 29_000_000_000,
      patent: byAccount.get('特許') || 2_000_000_000,
    },
  };
}

/**
 * MOF予算全体ビュー用データを生成
 *
 * 注: この値はdocs/20260202_0000_MOF予算全体とRS対象範囲の可視化.mdの分析結果に基づく
 */
function generateMOFBudgetData(): MOFBudgetData {
  return {
    fiscalYear: 2023,
    dataType: 'budget',

    // 一般会計（114.4兆円）
    generalAccount: {
      total: 114_380_000_000_000, // 114.38兆円

      revenue: {
        // 租税詳細（68.46兆円）
        taxes: {
          consumptionTax: 23_380_000_000_000, // 23.38兆円（34.2%）
          incomeTax: 21_050_000_000_000, // 21.05兆円（30.7%）
          corporateTax: 14_600_000_000_000, // 14.60兆円（21.3%）
          inheritanceTax: 2_780_000_000_000, // 2.78兆円（4.1%）
          gasolineTax: 2_000_000_000_000, // 2.00兆円（2.9%）
          sakeTax: 1_180_000_000_000, // 1.18兆円（1.7%）
          customsDuty: 1_120_000_000_000, // 1.12兆円（1.6%）
          tobaccoTax: 940_000_000_000, // 0.94兆円（1.4%）
          petroleumCoalTax: 650_000_000_000, // 0.65兆円（0.9%）
          automobileWeightTax: 380_000_000_000, // 0.38兆円（0.6%）
          powerDevelopmentTax: 320_000_000_000, // 0.32兆円（0.5%）
          otherTaxes: 60_000_000_000, // 0.06兆円（0.1%）
          total: 68_460_000_000_000, // 68.46兆円
        },
        publicBonds: 35_620_000_000_000, // 35.62兆円（31.1%）
        stampRevenue: 980_000_000_000, // 0.98兆円（0.9%）
        otherRevenue: 9_320_000_000_000, // 9.32兆円（8.1%）
        total: 114_380_000_000_000, // 114.38兆円
      },

      expenditure: {
        rsTarget: 72_560_000_000_000, // 72.56兆円（63.4%）
        debtService: 25_250_000_000_000, // 25.25兆円（22.1%）
        localAllocationTax: 16_400_000_000_000, // 16.40兆円（14.3%）
        reserves: 190_000_000_000, // 0.19兆円（0.2%）
        total: 114_400_000_000_000, // 114.40兆円
      },
    },

    // 特別会計（約443兆円 ※積上げ計算による）
    specialAccount: {
      total: 443_430_000_000_000, // 443.43兆円（各会計の合計）

      revenue: {
        insurancePremiums: {
          pension: 37_750_000_000_000, // 37.75兆円（決算ベース）
          labor: 3_650_000_000_000, // 3.65兆円
          other: 8_770_000_000_000, // 8.77兆円
          total: 50_170_000_000_000, // 50.17兆円
        },
        transferFromGeneral: buildTransferFromGeneral(), // 詳細版
        publicBonds: 165_120_000_000_000, // 165.12兆円（借換債）
        transferFromOther: 81_320_000_000_000, // 81.32兆円
        other: 114_310_000_000_000, // 114.31兆円（調整用）
        total: 443_430_000_000_000, // 443.43兆円
      },

      expenditure: {
        accounts: {
          pension: {
            total: 99_510_000_000_000,
            rsTarget: 68_520_000_000_000,
            rsExcluded: 30_990_000_000_000,
          },
          labor: {
            total: 8_660_000_000_000,
            rsTarget: 4_350_000_000_000,
            rsExcluded: 4_310_000_000_000,
          },
          energy: {
            total: 14_060_000_000_000,
            rsTarget: 1_510_000_000_000,
            rsExcluded: 12_550_000_000_000,
          },
          food: {
            total: 1_530_000_000_000,
            rsTarget: 1_050_000_000_000,
            rsExcluded: 480_000_000_000,
          },
          reconstruction: {
            total: 730_000_000_000,
            rsTarget: 540_000_000_000,
            rsExcluded: 190_000_000_000,
          },
          forex: {
            total: 2_420_000_000_000,
            rsTarget: 0,
            rsExcluded: 2_420_000_000_000,
          },
          debtRetirement: {
            total: 239_470_000_000_000,
            rsTarget: 0,
            rsExcluded: 239_470_000_000_000,
          },
          allocationTax: {
            total: 49_540_000_000_000,
            rsTarget: 0,
            rsExcluded: 49_540_000_000_000,
          },
          filp: {
            total: 24_940_000_000_000,
            rsTarget: 20_000_000_000,
            rsExcluded: 24_920_000_000_000,
          },
          others: {
            total: 2_570_000_000_000, // 調整値
            rsTarget: 2_570_000_000_000, // RS対象合計78.56兆円に合わせるための調整
            rsExcluded: 0,
          },
        },
        rsTarget: {
          total: 78_560_000_000_000, // 78.56兆円
        },
        rsExcluded: {
          total: 364_870_000_000_000, // 364.87兆円
        },
        total: 443_430_000_000_000, // 443.43兆円
      },
    },
  };
}

/**
 * メイン処理
 */
function main() {
  console.log('MOF予算全体ビュー用データ生成を開始します...');

  // データ生成
  const mofBudgetData = generateMOFBudgetData();

  // 検証
  console.log('\n=== データ検証 ===');
  console.log(
    `一般会計合計: ${(mofBudgetData.generalAccount.total / 1e12).toFixed(2)}兆円`
  );
  console.log(
    `特別会計合計: ${(mofBudgetData.specialAccount.total / 1e12).toFixed(2)}兆円`
  );
  console.log(
    `予算総額: ${((mofBudgetData.generalAccount.total + mofBudgetData.specialAccount.total) / 1e12).toFixed(2)}兆円`
  );

  const totalRSTarget =
    mofBudgetData.generalAccount.expenditure.rsTarget +
    mofBudgetData.specialAccount.expenditure.rsTarget.total;
  console.log(`RS対象合計: ${(totalRSTarget / 1e12).toFixed(2)}兆円`);

  const totalRSExcluded =
    mofBudgetData.generalAccount.expenditure.debtService +
    mofBudgetData.generalAccount.expenditure.localAllocationTax +
    mofBudgetData.generalAccount.expenditure.reserves +
    mofBudgetData.specialAccount.expenditure.rsExcluded.total;
  console.log(`RS対象外合計: ${(totalRSExcluded / 1e12).toFixed(2)}兆円`);

  console.log(
    `\n租税合計: ${(mofBudgetData.generalAccount.revenue.taxes.total / 1e12).toFixed(2)}兆円`
  );
  console.log(
    `  - 消費税: ${(mofBudgetData.generalAccount.revenue.taxes.consumptionTax / 1e12).toFixed(2)}兆円`
  );
  console.log(
    `  - 所得税: ${(mofBudgetData.generalAccount.revenue.taxes.incomeTax / 1e12).toFixed(2)}兆円`
  );
  console.log(
    `  - 法人税: ${(mofBudgetData.generalAccount.revenue.taxes.corporateTax / 1e12).toFixed(2)}兆円`
  );

  console.log(
    `\n社会保険料合計: ${(mofBudgetData.specialAccount.revenue.insurancePremiums.total / 1e12).toFixed(2)}兆円`
  );
  const premiums = mofBudgetData.specialAccount.revenue.insurancePremiums;
  const pensionAmount = 'breakdown' in premiums ? premiums.breakdown.pension : premiums.pension;
  console.log(
    `  - 年金保険料: ${(pensionAmount / 1e12).toFixed(2)}兆円`
  );

  // JSONファイルに保存
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mofBudgetData, null, 2));

  console.log(`\n✅ データ生成完了: ${OUTPUT_FILE}`);
  console.log(
    `   ファイルサイズ: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)}KB`
  );
}

// 実行
main();
