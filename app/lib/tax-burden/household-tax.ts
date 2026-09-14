import type { Reform, TaxParameters } from '@/types/tax-burden';

/** One adult in the household for a single calendar year. */
export interface AdultInput {
  age: number;
  /** Annual gross salary (0 when not working). */
  salary: number;
  /** Annual public pension received (0 before pension age). */
  pension: number;
  /** Covered by employee insurance (health + employees' pension + employment) through own employment. */
  employeeInsured: boolean;
}

export interface HouseholdInput {
  adults: AdultInput[];
  /** Ages of children living in the household (dependants). */
  childAges: number[];
  loneParent: boolean;
  bonus: boolean;
}

export interface HouseholdTaxes {
  incomeTax: number;
  residentTax: number;
  pension: number;
  health: number;
  care: number;
  employment: number;
  childBenefit: number;
  singleParentBenefit: number;
  pensionSupport: number;
  reformCredit: number;
  grossBurden: number;
  benefits: number;
  netBurden: number;
  salaryTotal: number;
  pensionTotal: number;
  gross: number;
  /** Adult indices whose resident tax is not fully exempt (used for care insurance stages). */
  residentTaxable: boolean[];
}

export const floorTo = (value: number, unit: number) => Math.floor(Math.max(0, value) / unit) * unit;

export function salaryIncome(gross: number, hasChildUnder23: boolean, p: TaxParameters): number {
  if (gross <= 0) return 0;
  const row = p.salaryDeduction.find(([upper]) => gross <= upper)!;
  const adjustment = hasChildUnder23 ? Math.max(0, Math.min(gross, 10000000) - 8500000) * 0.1 : 0;
  return Math.max(0, gross - (gross * row[1] + row[2]) - adjustment);
}

/** Miscellaneous income from public pensions (other income assumed at or below 10 million yen). */
export function pensionIncome(gross: number, age: number, p: TaxParameters): number {
  if (gross <= 0) return 0;
  const lp = p.lifecycle;
  const table = age >= 65 ? lp.pensionDeduction65 : lp.pensionDeductionUnder65;
  const minimum = age >= 65 ? lp.pensionDeductionMinimum65 : lp.pensionDeductionMinimumUnder65;
  const [, rate, fixed] = table.find(([upper]) => gross <= upper)!;
  return Math.max(0, gross - Math.max(minimum, gross * rate + fixed));
}

export function incomeTaxFromBase(base: number, p: TaxParameters): number {
  const taxable = floorTo(base, 1000);
  const [, rate, deduction] = p.incomeBrackets.find(([upper]) => taxable < upper)!;
  return floorTo((taxable * rate - deduction) * p.reconstructionMultiplier, 100);
}

export function standardMonthlyRemuneration(monthly: number, p: TaxParameters): number {
  const index = p.monthlyBoundaries.findIndex(upper => monthly < upper);
  return p.monthlyRemuneration[index < 0 ? p.monthlyRemuneration.length - 1 : index];
}

/** Employee-side contributions for one salaried adult. */
export function employeeContributions(salary: number, age: number, bonusMode: boolean, p: TaxParameters, multiplier: number) {
  const monthly = salary / (bonusMode ? 14 : 12);
  const standard = standardMonthlyRemuneration(monthly, p);
  const bonus = bonusMode ? floorTo(monthly, 1000) : 0;
  const pensionBase = Math.min(p.pensionCeiling, Math.max(p.pensionMinimum, standard)) * 12 + Math.min(p.pensionBonusCeiling, bonus) * 2;
  const healthBase = Math.min(p.healthCeiling, standard) * 12 + Math.min(p.healthBonusCeiling, bonus * 2);
  return {
    pension: age < 70 ? Math.round(pensionBase * p.pensionRate * multiplier) : 0,
    health: age < 75 ? Math.round(healthBase * p.healthRate * multiplier) : 0,
    care: age >= 40 && age < 65 ? Math.round(healthBase * p.careRate * multiplier) : 0,
    employment: Math.round(salary * p.employmentRate * multiplier),
    /** Average standard remuneration per month (for the earnings-related pension). */
    averageStandard: (Math.min(p.pensionCeiling, Math.max(p.pensionMinimum, standard)) * 12 + Math.min(p.pensionBonusCeiling, bonus) * 2) / 12,
  };
}

function perCapitaReduction(totalIncome: number, members: number, earners: number, reductions: [number, number, number, number][]) {
  for (const [ratio, base, perMember, perExtraEarner] of reductions) {
    if (totalIncome <= base + perMember * members + perExtraEarner * Math.max(0, earners - 1)) return ratio;
  }
  return 0;
}

export function computeHousehold(h: HouseholdInput, p: TaxParameters, reform: Reform): HouseholdTaxes {
  const lp = p.lifecycle;
  const hasChildUnder23 = h.childAges.some(a => a < 23);
  const hasSpouse = h.adults.length === 2;
  const incomes = h.adults.map(a => ({
    salary: salaryIncome(a.salary, hasChildUnder23, p),
    pension: pensionIncome(a.pension, a.age, p),
  }));
  const totals = incomes.map(i => i.salary + i.pension);
  const principal = hasSpouse && totals[1] > totals[0] ? 1 : 0;

  // 1. Resident-tax exemption flags depend only on income, so they can be settled before premiums.
  const dependants = h.childAges.length + (hasSpouse && totals[1 - principal] <= 580000 ? 1 : 0);
  const exemptFlags = h.adults.map((_, i) => {
    const reference = totals[i];
    const n = i === principal ? dependants : 0;
    const perCapitaLimit = 350000 * (1 + n) + 100000 + (n ? 210000 : 0);
    const incomeLimit = 350000 * (1 + n) + 100000 + (n ? 320000 : 0);
    const loneExempt = h.loneParent && reference <= 1350000;
    return { perCapita: loneExempt || reference <= perCapitaLimit, incomeShare: loneExempt || reference <= incomeLimit };
  });
  const householdTaxable = exemptFlags.some(f => !f.perCapita);

  // 2. Insurance premiums.
  let pension = 0, health = 0, care = 0, employment = 0;
  const personalPremiums = h.adults.map(() => 0);
  h.adults.forEach((a, i) => {
    if (a.salary > 0 && a.employeeInsured) {
      const c = employeeContributions(a.salary, a.age, h.bonus, p, reform.insuranceMultiplier);
      pension += c.pension; health += c.health; care += c.care; employment += c.employment;
      personalPremiums[i] += c.pension + c.health + c.care + c.employment;
    }
  });
  // National health insurance: adults under 75 without employee insurance, unless a dependant of an insured partner.
  const insuredPartner = (i: number) => hasSpouse && h.adults[1 - i].salary > 0 && h.adults[1 - i].employeeInsured && h.adults[1 - i].age < 75;
  const nhiMembers = h.adults.map((a, i) => i).filter(i => h.adults[i].age < 75 && !(h.adults[i].salary > 0 && h.adults[i].employeeInsured) && !insuredPartner(i));
  if (nhiMembers.length) {
    const nh = lp.nationalHealth;
    const memberIncome = nhiMembers.reduce((s, i) => s + totals[i], 0);
    const earners = nhiMembers.filter(i => totals[i] > 0).length;
    const reduction = perCapitaReduction(memberIncome, nhiMembers.length, earners, nh.reductions);
    const part = (rate: number, perCapita: number, cap: number, members: number[]) => {
      const incomeShare = members.reduce((s, i) => s + Math.max(0, totals[i] - p.localBasicAllowance) * rate, 0);
      return Math.min(cap, Math.round(incomeShare + perCapita * members.length * (1 - reduction)));
    };
    const careMembers = nhiMembers.filter(i => h.adults[i].age >= 40 && h.adults[i].age < 65);
    const basic = part(nh.basicRate, nh.basicPerCapita, nh.basicCap, nhiMembers);
    const support = part(nh.supportRate, nh.supportPerCapita, nh.supportCap, nhiMembers);
    const nhiCare = careMembers.length ? part(nh.careRate, nh.carePerCapita, nh.careCap, careMembers) : 0;
    health += Math.round((basic + support) * reform.insuranceMultiplier);
    care += Math.round(nhiCare * reform.insuranceMultiplier);
    const perMember = Math.round((basic + support + nhiCare) * reform.insuranceMultiplier / nhiMembers.length);
    nhiMembers.forEach(i => { personalPremiums[i] += perMember; });
  }
  // Latter-stage elderly medical insurance (75+), assessed per person with household-based reductions.
  const latterMembers = h.adults.map((_, i) => i).filter(i => h.adults[i].age >= 75);
  if (latterMembers.length) {
    const ls = lp.latterStageHealth;
    const householdIncome = totals.reduce((s, v) => s + v, 0);
    const earners = totals.filter(v => v > 0).length;
    const reduction = perCapitaReduction(householdIncome, h.adults.length, earners, ls.reductions);
    latterMembers.forEach(i => {
      const premium = Math.min(ls.cap, Math.round(Math.max(0, totals[i] - p.localBasicAllowance) * ls.rate + ls.perCapita * (1 - reduction)));
      const scaled = Math.round(premium * reform.insuranceMultiplier);
      health += scaled; personalPremiums[i] += scaled;
    });
  }
  // Long-term care insurance, first category (65+): national standard stages.
  h.adults.forEach((a, i) => {
    if (a.age < 65) return;
    const stages = lp.careFirstCategory.stages;
    const pensionPlusIncome = a.pension + totals[i] - incomes[i].pension;
    let stage: number;
    if (!exemptFlags[i].perCapita) {
      const income = totals[i];
      stage = income < 1200000 ? 6 : income < 2100000 ? 7 : income < 3200000 ? 8 : income < 4200000 ? 9
        : income < 5200000 ? 10 : income < 6200000 ? 11 : income < 7200000 ? 12 : 13;
    } else if (householdTaxable) {
      stage = pensionPlusIncome <= 800000 ? 4 : 5;
    } else {
      stage = pensionPlusIncome <= 800000 ? 1 : pensionPlusIncome <= 1200000 ? 2 : 3;
    }
    const premium = Math.round(lp.careFirstCategory.baseAnnual * stages.find(s => s.stage === stage)!.multiplier * reform.insuranceMultiplier);
    care += premium; personalPremiums[i] += premium;
  });

  // 3. Income tax and resident tax per adult.
  let incomeTax = 0, residentTax = 0;
  const residentTaxable: boolean[] = [];
  h.adults.forEach((a, i) => {
    const reference = totals[i];
    const social = personalPremiums[i];
    const partnerReference = hasSpouse ? totals[1 - i] : 0;
    const partnerAge = hasSpouse ? h.adults[1 - i].age : 0;
    const isPrincipal = i === principal;
    const spouseMultiplier = reference <= 9000000 ? 1 : reference <= 9500000 ? 2 / 3 : reference <= 10000000 ? 1 / 3 : 0;
    const spouseRow = p.spouseAllowances.find(([upper]) => partnerReference <= upper)!;
    const elderlySpouse = hasSpouse && isPrincipal && partnerAge >= 70 && partnerReference <= 580000;
    const spouseNational = elderlySpouse ? lp.elderlySpouseAllowance[0] : spouseRow[1];
    const spouseLocal = elderlySpouse ? lp.elderlySpouseAllowance[1] : spouseRow[2];
    const spouse = hasSpouse && isPrincipal ? Math.ceil(spouseNational * spouseMultiplier / 10000) * 10000 : 0;
    const localSpouse = hasSpouse && isPrincipal ? Math.ceil(spouseLocal * spouseMultiplier / 10000) * 10000 : 0;
    // Statutory personal-deduction difference for the spouse (used only by the local adjustment credit).
    let spouseDifference = 0;
    if (hasSpouse && isPrincipal && spouseMultiplier > 0) {
      const full = partnerReference <= 600000 ? 50000 : partnerReference <= 650000 ? 30000 : 0;
      spouseDifference = Math.ceil(full * spouseMultiplier / 10000) * 10000;
    }
    let dependantNational = 0, dependantLocal = 0, dependantDifference = 0;
    if (isPrincipal) {
      for (const age of h.childAges) {
        if (age >= 19 && age <= 22) { dependantNational += lp.dependantAllowanceSpecific[0]; dependantLocal += lp.dependantAllowanceSpecific[1]; dependantDifference += 180000; }
        else if (age >= 16) { dependantNational += lp.dependantAllowanceGeneral[0]; dependantLocal += lp.dependantAllowanceGeneral[1]; dependantDifference += 50000; }
      }
    }
    const basic = p.basicAllowances.find(([upper]) => reference <= upper)![1] + reform.basicAllowanceExtra;
    const parent = h.loneParent && isPrincipal && reference <= 5000000 ? 350000 : 0;
    const localParent = h.loneParent && isPrincipal && reference <= 5000000 ? 300000 : 0;
    incomeTax += incomeTaxFromBase(reference - social - basic - spouse - dependantNational - parent, p);

    const localBase = floorTo(reference - social - p.localBasicAllowance - localSpouse - dependantLocal - localParent, 1000);
    const deductionDifference = p.adjustmentBasicDifference + spouseDifference + dependantDifference + (parent ? 50000 : 0);
    const adjustment = localBase <= 2000000 ? 0.05 * Math.min(deductionDifference, localBase)
      : Math.max(2500, 0.05 * (deductionDifference - (localBase - 2000000)));
    const perCapita = exemptFlags[i].perCapita ? 0 : p.localPerCapita + p.localForestTax;
    const incomeShare = exemptFlags[i].incomeShare ? 0 : floorTo(localBase * p.localRate - adjustment, 100);
    residentTax += perCapita + incomeShare;
    residentTaxable.push(!exemptFlags[i].perCapita);
  });

  // 4. Cash benefits.
  const childBenefit = h.childAges.reduce((s, age) => s + (age <= 18 ? (age < 3 ? p.childMonthlyUnder3 : reform.childMonthly) * 12 : 0), 0);
  let singleParentBenefit = 0;
  const eligibleChildren = h.childAges.filter(age => age < 19).length;
  if (h.loneParent && eligibleChildren > 0) {
    const assessed = Math.max(0, totals[principal] - 80000);
    const dependantsCount = h.childAges.length;
    const full = p.singleParentThresholdBase + dependantsCount * p.singleParentThresholdPerChild;
    const limit = p.singleParentLimitBase + dependantsCount * p.singleParentThresholdPerChild;
    if (assessed < limit) {
      const excess = Math.max(0, assessed - full);
      const first = p.singleParentFullMonthly - (excess > 0 ? excess * p.singleParentFirstCoefficient + 10 : 0);
      const extra = p.singleParentExtraMonthly - (excess > 0 ? excess * p.singleParentExtraCoefficient + 10 : 0);
      singleParentBenefit = Math.max(0, Math.round((first + (eligibleChildren - 1) * extra) / 10) * 10 * 12);
    }
  }
  let pensionSupport = 0;
  if (!householdTaxable) {
    h.adults.forEach((a, i) => {
      if (a.age >= 65 && a.pension > 0 && a.pension + totals[i] - incomes[i].pension <= lp.pensionSupport.incomeThreshold) {
        pensionSupport += lp.pensionSupport.monthly * 12;
      }
    });
  }
  const salaryTotal = h.adults.reduce((s, a) => s + a.salary, 0);
  const pensionTotal = h.adults.reduce((s, a) => s + a.pension, 0);
  const gross = salaryTotal + pensionTotal;
  const reformCredit = Math.round(Math.max(0, reform.creditAnnual - Math.max(0, gross - reform.creditPhaseoutStart) * reform.creditPhaseoutRate));
  const grossBurden = incomeTax + residentTax + pension + health + care + employment;
  const benefits = childBenefit + singleParentBenefit + pensionSupport + reformCredit;
  return { incomeTax, residentTax, pension, health, care, employment, childBenefit, singleParentBenefit, pensionSupport, reformCredit,
    grossBurden, benefits, netBurden: grossBurden - benefits, salaryTotal, pensionTotal, gross, residentTaxable };
}
