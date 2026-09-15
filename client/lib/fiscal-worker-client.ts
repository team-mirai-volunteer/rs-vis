import type { FiscalForm } from './fiscal-space-form';
import type { FiscalCalculation, FiscalWorkerRequest, FiscalWorkerResponse } from './fiscal-space-engine';

export interface FiscalWorkerPort {
  postMessage: (request: FiscalWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<FiscalWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type FiscalWorkerError = 'worker' | 'calculation' | 'timeout';
export const FISCAL_WORKER_TIMEOUT = 30_000;

/** At most one running job and one waiting input. Invalidate results as soon
 * as input changes, even before the debounce timer has expired. */
export function createFiscalWorkerClient(port: FiscalWorkerPort, callbacks: {
  result: (form: FiscalForm, result: FiscalCalculation) => void;
  error: (kind: FiscalWorkerError) => void;
}, delay = 160, timeout = FISCAL_WORKER_TIMEOUT) {
  let revision = 0;
  let active: FiscalWorkerRequest | undefined;
  let queued: FiscalWorkerRequest | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let ready = false;
  let disposed = false;
  const flush = () => {
    if (disposed || active || !ready || !queued) return;
    active = queued;
    queued = undefined;
    watchdog = setTimeout(() => fail('timeout'), timeout);
    try { port.postMessage(active); }
    catch { fail(); }
  };
  const fail = (kind: FiscalWorkerError = 'worker') => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    active = queued = undefined;
    port.onmessage = null;
    port.onerror = null;
    port.onmessageerror = null;
    port.terminate();
    callbacks.error(kind);
  };
  port.onmessage = ({ data }) => {
    if (disposed || !active || active.id !== data.id) return;
    const completed = active;
    clearTimeout(watchdog);
    active = undefined;
    if (data.id === revision) {
      if (data.ok) callbacks.result(completed.form, data.result);
      else callbacks.error('calculation');
    }
    flush();
  };
  port.onerror = event => { event.preventDefault(); fail(); };
  port.onmessageerror = () => fail();
  return {
    submit(form: FiscalForm) {
      if (disposed) return;
      queued = { id: ++revision, form };
      ready = false;
      clearTimeout(timer);
      timer = setTimeout(() => { ready = true; flush(); }, delay);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      clearTimeout(watchdog);
      port.onmessage = null;
      port.onerror = null;
      port.onmessageerror = null;
      port.terminate();
    },
  };
}
