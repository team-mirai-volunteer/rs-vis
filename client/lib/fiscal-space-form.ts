import { initialEconomy, PARAMETERS, POLICIES, THRESHOLDS } from '@/app/lib/fiscal-space/assumptions';
import { LONG_RUN } from '@/app/lib/fiscal-space/long-run';
import { SUPPLY_CASES } from '@/app/lib/fiscal-space/supply';
import { INDUSTRY_CASE, SEMICONDUCTOR_CASE, powerCase } from '@/app/lib/fiscal-space/policy-trade';
import { CORPORATE_WAGE_SHARE } from '@/app/lib/fiscal-space/burden-data';
import type { JapanDataset } from '@/app/lib/fiscal-space/japan-data';
import type { Policy, PolicyKind } from '@/types/fiscal-space';
import type { TradeForm } from './fiscal-space-trade';
import { RESOURCE_DEFAULTS, resourcePowerBalance } from '@/app/lib/fiscal-space/resource-estimate';
import { DEFAULT_STRESSES } from '@/app/lib/fiscal-space/stress-envelope';

export const defaults = (dataset: JapanDataset = 'latest') => {
  const initial = initialEconomy(dataset);
  return { dataset, horizon: 5, inputs: { ...initial.production.inputs }, longRun: { ...LONG_RUN }, loads: {} as Record<string, Policy['load']>, resource: { ...RESOURCE_DEFAULTS }, corporateShare: CORPORATE_WAGE_SHARE,
  supply: Object.fromEntries(Object.entries(SUPPLY_CASES).map(([id, ref]) => [id, { ...ref.settings }])),
  trade: { selected: 'semiconductors', industry: Object.fromEntries(POLICIES.map(policy => [policy.id, { ...(policy.id === 'semiconductors' ? SEMICONDUCTOR_CASE : INDUSTRY_CASE) }])), power: powerCase('solar') } as TradeForm,
  policySettings: Object.fromEntries(POLICIES.map(policy => [policy.id, { kind: policy.kind, duration: policy.duration }])) as Record<string, { kind: PolicyKind; duration: number }>,
  rateShock: 0, energyShock: 0, stresses: { ...DEFAULT_STRESSES },
  calibration: structuredClone(PARAMETERS),
  gap: Number(((initial.macro.realGdp / initial.macro.potentialGdp - 1) * 100).toFixed(1)),
  inflation: initial.macro.inflation * 100,
  construction: initial.labour.sectorUtilization.construction * 100, firmCapacity: resourcePowerBalance(0, 0, 0, RESOURCE_DEFAULTS).nationalSupplyGw,
  amounts: Object.fromEntries(POLICIES.map(p => [p.id, 0])) as Record<string, number>, thresholds: { ...THRESHOLDS } };
};

export type FiscalForm = ReturnType<typeof defaults>;
