import { POWER_TECHNOLOGIES, powerCase, type IndustryTradeCase, type PowerCase, type PowerTechnology } from '@/app/lib/fiscal-space/policy-trade';

export interface TradeForm {
  selected: string;
  industry: Record<string, IndustryTradeCase>;
  power: PowerCase;
  mix?: Record<PowerTechnology, number>;
  powerCases?: Record<PowerTechnology, PowerCase>;
}
export function configuredPower(value: TradeForm): PowerCase {
  const mix = value.mix;
  return mix ? {
    ...value.power,
    mix: (Object.keys(POWER_TECHNOLOGIES) as PowerTechnology[]).map(technology => ({
      share: mix[technology], assumptions: value.powerCases?.[technology] ?? powerCase(technology),
    })),
  } : value.power;
}
