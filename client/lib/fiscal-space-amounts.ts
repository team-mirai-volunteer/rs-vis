import { TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { policyReliefLimit } from '@/app/lib/fiscal-space/policy-limits';
import type { ModelParameters } from '@/types/fiscal-space';

/** Align the insurance control to its 0.1 trillion step, rounding down. */
export const policyInputLimitYen = (id: string, p: ModelParameters) => id === 'social-insurance'
  ? Math.floor(policyReliefLimit(id, p) / 1e11) * 1e11 : policyReliefLimit(id, p);

/** Form amounts are trillion yen; the engine and revenue caps use yen. */
export const policyCostYen = (id: string, amount: number, p: ModelParameters) =>
  Math.min(amount * TRILLION, policyInputLimitYen(id, p));

export const totalPolicyCostYen = (amounts: Record<string, number>, p: ModelParameters) =>
  Object.entries(amounts).reduce((sum, [id, amount]) => sum + policyCostYen(id, amount, p), 0);
