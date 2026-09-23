'use client';

import { useEffect, useRef, useState } from 'react';
import type { FiscalForm } from '../lib/fiscal-space-form';
import type { OptimizationProgress, OptimizationResult, OptimizationWorkerResponse } from '../lib/fiscal-optimizer';
import { validateOptimization } from '../lib/fiscal-objective';

export function useFiscalOptimization(form: FiscalForm) {
  const key = JSON.stringify(form);
  const liveKey = useRef(key);
  liveKey.current = key;
  const worker = useRef<Worker>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [progress, setProgress] = useState<OptimizationProgress>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<{ key: string; result: OptimizationResult; applied: boolean }>();
  const stop = () => {
    worker.current?.terminate(); worker.current = undefined;
    clearTimeout(timer.current);
  };
  useEffect(() => {
    if (worker.current) {
      stop(); setRunning(false); setError('条件が変更されたため探索を停止しました。新しい条件で再探索してください。');
    }
  }, [key]);
  useEffect(() => () => stop(), []);
  const start = () => {
    stop(); setError(''); setProgress(undefined); setCompleted(undefined);
    try {
      validateOptimization(form.optimization);
      const snapshot = structuredClone(form);
      const w = new Worker(new URL('../workers/fiscal-optimizer.worker.ts', import.meta.url));
      worker.current = w; setRunning(true);
      const fail = (message: string) => { if (worker.current !== w) return; stop(); setRunning(false); setError(message); };
      w.onmessage = ({ data }: MessageEvent<OptimizationWorkerResponse>) => {
        if (worker.current !== w || liveKey.current !== key) return;
        if (data.kind === 'progress') setProgress(data.progress);
        else if (data.kind === 'error') fail(data.error);
        else { stop(); setRunning(false); setCompleted({ key, result: data.result, applied: false }); }
      };
      w.onerror = event => { event.preventDefault(); fail('探索を実行できませんでした。再試行してください。'); };
      w.onmessageerror = () => fail('探索結果を受け取れませんでした。再試行してください。');
      timer.current = setTimeout(() => fail('探索が時間内に完了しませんでした。対象政策や評価期間を減らして再試行してください。'), 120_000);
      w.postMessage(snapshot);
    } catch (error) { stop(); setRunning(false); setError(error instanceof Error ? error.message : '探索を開始できませんでした。'); }
  };
  return { start, running, progress, error, completed, stale: completed !== undefined && completed.key !== key,
    cancel: () => { stop(); setRunning(false); setError('探索を中止しました。政策の入力額は変更していません。'); },
    markApplied: (amounts: FiscalForm['amounts']) => setCompleted(previous => previous ? {
      ...previous, key: JSON.stringify({ ...form, amounts }), applied: true,
    } : previous),
  };
}
