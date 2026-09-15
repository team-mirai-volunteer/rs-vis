import { TRILLION } from '@/app/lib/fiscal-space/assumptions';
import { consumptionTaxLimit } from '@/app/lib/fiscal-space/calibration';
import type { ModelParameters } from '@/types/fiscal-space';

/** Form amounts are trillion yen; the engine and tax cap use yen. */
export const policyCostYen = (id: string, amount: number, p: ModelParameters) =>
  Math.min(amount * TRILLION, id === 'consumption-tax' ? consumptionTaxLimit(p) : Infinity);

export const totalPolicyCostYen = (amounts: Record<string, number>, p: ModelParameters) =>
  Object.entries(amounts).reduce((sum, [id, amount]) => sum + policyCostYen(id, amount, p), 0);
