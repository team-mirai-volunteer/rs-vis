import { createFiscalEngine, type FiscalWorkerRequest, type FiscalWorkerResponse } from '../lib/fiscal-space-engine';

const calculate = createFiscalEngine();
self.onmessage = (event: MessageEvent<FiscalWorkerRequest>) => {
  const { id, form } = event.data;
  let response: FiscalWorkerResponse;
  try { response = { id, ok: true, result: calculate(form) }; }
  catch { response = { id, ok: false, error: 'calculation' }; }
  self.postMessage(response);
};
