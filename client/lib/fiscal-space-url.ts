import { defaults, type FiscalForm } from './fiscal-space-form';
import { PARAMETERS, POLICIES } from '@/app/lib/fiscal-space/assumptions';
import { EMPTY_PROJECT_BASIS, effectiveLoad } from '@/app/lib/fiscal-space/policy-load';
import { powerCase } from '@/app/lib/fiscal-space/policy-trade';
import { validateScenarioNumber } from './fiscal-space-ranges';
import { policyInputLimitYen } from './fiscal-space-amounts';
import { RESOURCE_DEFAULTS, RESOURCE_REGIONS } from '@/app/lib/fiscal-space/resource-estimate';

export const FISCAL_MODEL_VERSION = '2026-09-16.3';
const ids = POLICIES.map(p => p.id);
const enums: Record<string, readonly string[]> = {
  dataset: ['2024', 'latest'], referenceModel: ['ef2026', 'esri2022'],
  productionModel: ['leontief', 'ces', 'cobbDouglas'], kind: ['temporary', 'permanent', 'growth'],
  technology: ['solar', 'nuclear', 'hydro'], selected: ids,
  mode: ['estimated', 'manual'], region: ['demand-share', ...RESOURCE_REGIONS],
};

function shape(value: unknown, template: unknown, path: string): void {
  const key = path.split('.').at(-1) ?? '';
  if (typeof template === 'number' || template === null) {
    if (value === null && template === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e16) throw new Error(path);
    validateScenarioNumber(value, template, path);
    if (/\.(lag|lifetime|duration|years|rampYears|taxCollectionLag|newDebtMaturity)$/.test(path) &&
      (!Number.isInteger(value) || value < 0 || value > 100)) throw new Error(path);
    return;
  }
  if (typeof template === 'string') {
    const allowed = path.startsWith('form.supply.') ? [template] : enums[key] ?? [template];
    if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(path);
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !template || typeof template !== 'object') throw new Error(path);
  const expected = template as Record<string, unknown>;
  const actual = value as Record<string, unknown>;
  for (const k of Object.keys(actual)) {
    if (!Object.hasOwn(expected, k)) throw new Error(`${path}.${k}`);
    shape(actual[k], expected[k], `${path}.${k}`);
  }
  for (const k of Object.keys(expected)) {
    const optionalIndustryField = path.startsWith('form.trade.industry.') &&
      ['additionality', 'depreciation'].includes(k);
    const optionalLoadBasis = path.startsWith('form.loads.') && k === 'basis';
    const optionalCapitalField = path.startsWith('form.supply.') && ['serviceShare', 'realizationRate', 'rampYears', 'referenceOverlap'].includes(k);
    const optionalTradeField = path === 'form.trade' && ['mix', 'powerCases'].includes(k);
    if (!Object.hasOwn(actual, k) && !optionalIndustryField && !optionalTradeField && !optionalLoadBasis && !optionalCapitalField && path !== 'form.loads') {
      throw new Error(`${path}.${k}`);
    }
  }
}

/** Validate the entire input before submitting the model/search to the worker. */
export function decodeScenario(hash: string): FiscalForm {
  if (!hash.startsWith('#scenario=') || hash.length > 50000) throw new Error('Invalid scenario URL');
  const payload: unknown = JSON.parse(decodeURIComponent(hash.slice(10)));
  if (!payload || typeof payload !== 'object' || !('version' in payload) || ![FISCAL_MODEL_VERSION, '2026-09-16.2', '2026-09-16.1', '2026-09-15.8', '2026-09-15.7', '2026-09-15.6', '2026-09-15.5', '2026-09-15.4', '2026-09-15.3', '2026-09-15.2'].includes(String(payload.version)) || !('form' in payload)) throw new Error('Unsupported model version');
  if (payload.version !== FISCAL_MODEL_VERSION && payload.form && typeof payload.form === 'object' && 'calibration' in payload.form) {
    // Old links retain their manual/unevaluated load assumptions, never silently opt in.
    if (!Object.hasOwn(payload.form, 'resource')) Object.assign(payload.form, { resource: { ...RESOURCE_DEFAULTS, mode: 'manual' } });
    const calibration = payload.form.calibration;
    if (calibration && typeof calibration === 'object' && !Array.isArray(calibration)) {
      for (const key of ['energyDomesticPricePassThrough', 'expenditurePriceIndexation', 'capacityPriceSensitivity', 'capacityPressureStart', 'referenceCapacityRatio'] as const) {
        if (!Object.hasOwn(calibration, key)) Object.assign(calibration, { [key]: PARAMETERS[key] });
      }
    }
  }
  const template = defaults();
  const technologies = ['solar', 'nuclear', 'hydro'] as const;
  template.trade.mix = { solar: 1, nuclear: 0, hydro: 0 };
  template.trade.powerCases = { solar: powerCase('solar'), nuclear: powerCase('nuclear'), hydro: powerCase('hydro') };
  // A numeric default must not remove the explicit unknown option or break saved links.
  template.trade.power.firmShare = null;
  for (const item of Object.values(template.trade.powerCases)) item.firmShare = null;
  for (const item of Object.values(template.trade.industry)) {
    item.additionality = 1;
    item.depreciation = 0;
  }
  for (const id of ids) template.loads[id] = {
    sectorUtilizationPerTrillion: null, peakGwPerTrillion: null,
    operatingPeakGwPerTrillion: null, lag: 0, lifetime: 1, depreciation: 0, basis: { ...EMPTY_PROJECT_BASIS },
  };
  shape(payload.form, template, 'form');
  const form = payload.form as FiscalForm;
  const range = (v: number, min: number, max: number) => { if (v < min || v > max) throw new Error('Out of range'); };
  if (![1, 3, 5].includes(form.horizon)) throw new Error('Invalid horizon');
  range(form.gap, -10, 3); range(form.inflation, -3, 10); range(form.reserve, 0, 50);
  range(form.rateShock, 0, 300); range(form.energyShock, 0, 100);
  range(form.calibration.capacityPriceSensitivity, 0, .1); range(form.calibration.capacityPressureStart, 0, .99); range(form.calibration.referenceCapacityRatio, 1.001, 2);
  for (const key of ['energyPricePassThrough', 'energyDomesticPricePassThrough', 'expenditurePriceIndexation'] as const) range(form.calibration[key], 0, 1);
  range(form.longRun.years, 6, 100);
  for (const amount of Object.values(form.amounts)) range(amount, 0, 100);
  for (const [id, amount] of Object.entries(form.amounts)) range(amount, 0, policyInputLimitYen(id, form.calibration) / 1e12);
  for (const settings of Object.values(form.policySettings)) range(settings.duration, 1, 10);
  for (const v of Object.values(form.inputs)) range(v, 1, 1.5);
  for (const v of Object.values(form.thresholds)) range(v, .0001, 100);
  for (const key of ['searchCap', 'searchStep', 'searchTolerance'] as const) {
    if (form.calibration[key] !== PARAMETERS[key]) throw new Error('Search settings are fixed');
  }
  for (const load of Object.values(form.loads)) {
    if (!load) continue;
    const c = effectiveLoad(load);
    for (const v of [c.sectorUtilizationPerTrillion, c.peakGwPerTrillion, c.operatingPeakGwPerTrillion]) {
      if (v !== null) range(v, 0, 1e6);
    }
    range(c.depreciation, 0, 1); range(c.lifetime, 1, 100);
  }
  const mix = form.trade.mix;
  if (mix && technologies.reduce((sum, key) => sum + mix[key], 0) <= 0) throw new Error('Empty power mix');
  return form;
}

export function encodeScenario(form: FiscalForm): string {
  const hash = '#scenario=' + encodeURIComponent(JSON.stringify({ version: FISCAL_MODEL_VERSION, form }));
  decodeScenario(hash);
  return hash;
}
