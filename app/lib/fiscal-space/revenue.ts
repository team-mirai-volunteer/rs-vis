/** Shared by the simulation and conditional historical revenue checks. */
export function projectRevenue(initialRevenue: number, initialGdp: number, revenueGdp: number, elasticity: number, taxCut = 0) {
  return initialRevenue * (revenueGdp / initialGdp) ** elasticity - taxCut;
}

export interface RevenueComponents { taxes: number; socialContributions: number }
/** Taxes and social contributions grow from the same nominal-GDP base with their own
 * elasticities. Relief is deducted from the component it belongs to; the total is the sum. */
export function projectRevenueComponents(initial: RevenueComponents, initialGdp: number, revenueGdp: number,
  elasticity: { taxes: number; socialContributions: number }, relief: RevenueComponents = { taxes: 0, socialContributions: 0 }) {
  const taxes = projectRevenue(initial.taxes, initialGdp, revenueGdp, elasticity.taxes, relief.taxes);
  const socialContributions = projectRevenue(initial.socialContributions, initialGdp, revenueGdp, elasticity.socialContributions, relief.socialContributions);
  return { taxes, socialContributions, total: taxes + socialContributions };
}
/** Which revenue component a relief policy reduces. */
export const reliefComponent = (policyId: string): keyof RevenueComponents =>
  policyId === 'social-insurance' ? 'socialContributions' : 'taxes';
