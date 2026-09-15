import type { EconomyState, ModelParameters, Policy, PolicyComparison } from '@/types/fiscal-space';
import { POWER_TECHNOLOGIES, powerComponents } from './policy-trade';
import { projectResponses, projectNetOutput } from './project-response';
import { hasCommercialSupply, supplyTotal } from './supply';

/** Annual capacity at commissioning of the additional one-year investment.
 * This is an engineering / supply scenario at initial prices, not a forecast
 * of GDP or world demand in that future year. Keep the current mix fixed. */
export function investmentAtCommissioning(initial: EconomyState, current: Policy[], incremental: Policy, p: ModelParameters): PolicyComparison['investment'] {
  const commercial = hasCommercialSupply(incremental);
  const project = commercial || incremental.id === 'generation' ? incremental.trade : undefined;
  const supply = !commercial ? incremental.supply : undefined;
  if (!project && (!supply || supply.kind === 'childcare')) return undefined;
  const components = project?.kind === 'power' ? powerComponents(project.assumptions) : undefined;
  // For a mix, show the first year when every allocated technology has started.
  const startYear = 1 + (components ? Math.max(...components.map(x => x.assumptions.lag)) : project?.assumptions.lag ?? supply!.lag);
  const lifetime = components ? Math.min(...components.map(x => POWER_TECHNOLOGIES[x.assumptions.technology].lifetime))
    : project?.kind === 'industry' ? project.assumptions.lifetime : supply!.lifetime;
  const result: NonNullable<PolicyComparison['investment']> = { startYear, lifetime };
  if (components && components.length > 1) result.timings = components.map(x => ({ name: POWER_TECHNOLOGIES[x.assumptions.technology].name, startYear: x.assumptions.lag + 1, lifetime: POWER_TECHNOLOGIES[x.assumptions.technology].lifetime }));
  if (commercial || supply?.kind === 'grid') {
    const withProject = projectResponses(initial, [...current, incremental], startYear, p);
    const withoutProject = projectResponses(initial, current, startYear, p);
    const delta = (key: 'exports' | 'substitution' | 'operatingImports') =>
      withProject.reduce((sum, r) => sum + r[key], 0) - withoutProject.reduce((sum, r) => sum + r[key], 0);
    const exports = delta('exports'), substitution = delta('substitution'), operatingImports = delta('operatingImports');
    const imports = operatingImports - substitution;
    result.trade = { exports, imports, substitution, operatingImports, tradeBalance: exports - imports };
    const potential = (flows: typeof withProject) => flows.reduce((sum, r) => sum + Math.max(0, projectNetOutput(r)), 0);
    result.supply = potential(withProject) - potential(withoutProject);
  } else if (supply) {
    result.supply = supplyTotal(initial, [...current, incremental], startYear, p) - supplyTotal(initial, current, startYear, p);
  }
  return result;
}
