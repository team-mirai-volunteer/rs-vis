#!/usr/bin/env npx tsx
/**
 * MOF繰入データ検証スクリプト
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { MOFBudgetData } from '@/types/mof-budget-overview';
import type { TransferFromGeneralAccount } from '@/types/mof-transfer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(
  __dirname,
  '../public/data/mof-budget-overview-2023.json'
);

function formatTrillion(amount: number): string {
  return `${(amount / 1e12).toFixed(2)}兆円`;
}

function validate() {
  console.log('\n=== MOF繰入データ検証 ===\n');

  // データ読み込み
  const rawData = fs.readFileSync(DATA_FILE, 'utf-8');
  const data: MOFBudgetData = JSON.parse(rawData);

  const transfer = data.specialAccount.revenue.transferFromGeneral;

  // 型チェック
  if (typeof transfer === 'number') {
    console.log('❌ 詳細データが含まれていません（number型のみ）');
    return;
  }

  console.log('✅ 詳細データ構造を検出');
  const transferDetail = transfer as TransferFromGeneralAccount;

  // 合計値チェック
  console.log('\n--- 合計値 ---');
  console.log(`実質繰入額（国債除く）: ${formatTrillion(transferDetail.total)}`);
  console.log(`繰入総額（国債含む）  : ${formatTrillion(transferDetail.totalIncludingDebt)}`);
  console.log(`国債整理基金        : ${formatTrillion(transferDetail.breakdown.debtRetirement.total)}`);

  // 内訳合計の検証
  const breakdownTotal =
    transferDetail.breakdown.pension.total +
    transferDetail.breakdown.localAllocationTax.total +
    transferDetail.breakdown.debtRetirement.total +
    transferDetail.breakdown.energy.total +
    transferDetail.breakdown.foodSupply +
    transferDetail.breakdown.laborInsurance +
    transferDetail.breakdown.automotiveSafety +
    transferDetail.breakdown.reconstruction +
    transferDetail.breakdown.forestryDebtManagement +
    transferDetail.breakdown.patent;

  console.log(`\n内訳合計          : ${formatTrillion(breakdownTotal)}`);

  const diff = transferDetail.totalIncludingDebt - breakdownTotal;
  if (Math.abs(diff) < 1e9) {  // 10億円未満の誤差は許容
    console.log('✅ 合計値一致');
  } else {
    console.log(`⚠️  差異: ${formatTrillion(diff)}`);
  }

  // 個別項目の検証
  console.log('\n--- 年金特別会計への繰入 ---');
  console.log(`  合計          : ${formatTrillion(transferDetail.breakdown.pension.total)}`);
  console.log(`  - 基礎年金      : ${formatTrillion(transferDetail.breakdown.pension.details.basicPension)}`);
  console.log(`  - 保育給付      : ${formatTrillion(transferDetail.breakdown.pension.details.nurseryBenefit)}`);
  console.log(`  - 児童手当      : ${formatTrillion(transferDetail.breakdown.pension.details.childAllowance)}`);
  console.log(`  - その他        : ${formatTrillion(transferDetail.breakdown.pension.details.pensionAdministration)}`);

  const pensionDetailTotal =
    transferDetail.breakdown.pension.details.basicPension +
    transferDetail.breakdown.pension.details.nurseryBenefit +
    transferDetail.breakdown.pension.details.childAllowance +
    transferDetail.breakdown.pension.details.pensionAdministration;

  if (Math.abs(transferDetail.breakdown.pension.total - pensionDetailTotal) < 1e9) {
    console.log('  ✅ 年金詳細合計一致');
  } else {
    console.log(`  ⚠️  差異: ${formatTrillion(transferDetail.breakdown.pension.total - pensionDetailTotal)}`);
  }

  console.log('\n--- 交付税配付金特別会計への繰入 ---');
  console.log(`  合計                  : ${formatTrillion(transferDetail.breakdown.localAllocationTax.total)}`);
  console.log(`  - 一般交付税交付金      : ${formatTrillion(transferDetail.breakdown.localAllocationTax.details.generalTransfer)}`);
  console.log(`  - 地方特例交付金        : ${formatTrillion(transferDetail.breakdown.localAllocationTax.details.specialTransfer)}`);
  console.log(`  - 交通反則者納金財源     : ${formatTrillion(transferDetail.breakdown.localAllocationTax.details.trafficViolationFund)}`);

  const localDetailTotal =
    transferDetail.breakdown.localAllocationTax.details.generalTransfer +
    transferDetail.breakdown.localAllocationTax.details.specialTransfer +
    transferDetail.breakdown.localAllocationTax.details.trafficViolationFund;

  if (Math.abs(transferDetail.breakdown.localAllocationTax.total - localDetailTotal) < 1e9) {
    console.log('  ✅ 交付税詳細合計一致');
  } else {
    console.log(`  ⚠️  差異: ${formatTrillion(transferDetail.breakdown.localAllocationTax.total - localDetailTotal)}`);
  }

  console.log('\n--- 国債整理基金特別会計への繰入 ---');
  console.log(`  合計                : ${formatTrillion(transferDetail.breakdown.debtRetirement.total)}`);
  console.log(`  - 普通国債等償還財源  : ${formatTrillion(transferDetail.breakdown.debtRetirement.details.ordinaryBondRedemption)}`);
  console.log(`  - 年金特例公債償還    : ${formatTrillion(transferDetail.breakdown.debtRetirement.details.pensionBondRedemption)}`);
  console.log(`  - 出資国債等償還      : ${formatTrillion(transferDetail.breakdown.debtRetirement.details.investmentBondRedemption)}`);

  console.log('\n--- その他特別会計への繰入 ---');
  console.log(`  エネルギー対策      : ${formatTrillion(transferDetail.breakdown.energy.total)}`);
  console.log(`  食料安定供給        : ${formatTrillion(transferDetail.breakdown.foodSupply)}`);
  console.log(`  労働保険          : ${formatTrillion(transferDetail.breakdown.laborInsurance)}`);
  console.log(`  自動車安全         : ${formatTrillion(transferDetail.breakdown.automotiveSafety)}`);
  console.log(`  復興             : ${formatTrillion(transferDetail.breakdown.reconstruction)}`);
  console.log(`  林野債務管理        : ${formatTrillion(transferDetail.breakdown.forestryDebtManagement)}`);
  console.log(`  特許             : ${formatTrillion(transferDetail.breakdown.patent)}`);

  // トップ3の特別会計
  console.log('\n--- トップ3特別会計（繰入額） ---');
  const accounts = [
    { name: '国債整理基金', amount: transferDetail.breakdown.debtRetirement.total },
    { name: '交付税配付金', amount: transferDetail.breakdown.localAllocationTax.total },
    { name: '年金', amount: transferDetail.breakdown.pension.total },
    { name: 'エネルギー対策', amount: transferDetail.breakdown.energy.total },
    { name: '食料安定供給', amount: transferDetail.breakdown.foodSupply },
  ].sort((a, b) => b.amount - a.amount);

  accounts.slice(0, 3).forEach((acc, i) => {
    console.log(`  ${i + 1}. ${acc.name.padEnd(15)} ${formatTrillion(acc.amount)}`);
  });

  console.log('\n✅ 検証完了\n');
}

validate();
