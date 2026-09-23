import { optimizeFiscalPolicy, type OptimizationWorkerResponse } from '../lib/fiscal-optimizer';
import type { FiscalForm } from '../lib/fiscal-space-form';

self.onmessage = ({ data }: MessageEvent<FiscalForm>) => {
  const send = (response: OptimizationWorkerResponse) => self.postMessage(response);
  try {
    const result = optimizeFiscalPolicy(data, progress => send({ kind: 'progress', progress }));
    send({ kind: 'result', result });
  } catch (error) {
    send({ kind: 'error', error: error instanceof Error ? error.message : '探索を完了できませんでした。' });
  }
};
