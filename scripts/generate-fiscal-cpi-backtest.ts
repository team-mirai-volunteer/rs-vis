import { execFileSync } from 'node:child_process';
import { PARAMETERS } from '../app/lib/fiscal-space/assumptions';

execFileSync('python', ['scripts/fiscal_cpi_backtest.py', '--anchor', String(PARAMETERS.baselineInflation * 100),
  '--rho', String(PARAMETERS.inflationPersistence), '--beta', String(PARAMETERS.gapInflationSlope)], { stdio: 'inherit' });
