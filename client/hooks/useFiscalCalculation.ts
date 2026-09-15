'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import type { FiscalForm } from '../lib/fiscal-space-form';
import type { FiscalCalculation } from '../lib/fiscal-space-engine';
import { createFiscalWorkerClient, type FiscalWorkerError } from '../lib/fiscal-worker-client';

export function useFiscalCalculation(form: FiscalForm) {
  const [completed, setCompleted] = useState<{ form: FiscalForm; result: FiscalCalculation }>();
  const [error, setError] = useState<FiscalWorkerError>();
  const [attempt, setAttempt] = useState(0);
  const client = useRef<ReturnType<typeof createFiscalWorkerClient>>();
  useEffect(() => {
    try {
      const worker = new Worker(new URL('../workers/fiscal-space.worker.ts', import.meta.url));
      client.current = createFiscalWorkerClient(worker, {
        result: (snapshot, result) => {
          startTransition(() => setCompleted({ form: snapshot, result }));
          setError(undefined);
        },
        error: kind => { if (kind !== 'calculation') client.current = undefined; setError(kind); },
      });
    } catch { setError('worker'); }
    return () => { client.current?.dispose(); client.current = undefined; };
  }, [attempt]);
  useEffect(() => {
    if (client.current) {
      setError(undefined);
      client.current.submit(form);
    }
  }, [form, attempt]);
  return { completed, error, pending: !error && completed?.form !== form,
    retry: () => {
      // Stop a stalled/obsolete computation immediately, before starting a fresh worker.
      client.current?.dispose(); client.current = undefined;
      setError(undefined); setAttempt(n => n + 1);
    } };
}
