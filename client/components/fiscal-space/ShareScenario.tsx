import { useEffect, useState } from 'react';
import type { FiscalForm } from '@/client/lib/fiscal-space-form';
import { encodeScenario, FISCAL_MODEL_VERSION, type ScenarioRestore } from '@/client/lib/fiscal-space-url';
import { Button } from '@/components/ui/button';

export function ShareScenario({ form, onPreset, error, restore }: {
  form: FiscalForm; onPreset: (amounts: Record<string, number>) => void; error: string; restore?: ScenarioRestore | null;
}) {
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const [calculatedOn, setCalculatedOn] = useState('');
  useEffect(() => {
    setLink(''); setNotice('');
    setCalculatedOn(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()));
  }, [form]);
  const share = async () => {
    try {
      const url = new URL(window.location.href);
      url.hash = encodeScenario(form);
      window.history.replaceState(null, '', url);
      setLink(url.href);
      try { await navigator.clipboard.writeText(url.href); setNotice('条件付きURLをコピーしました。'); }
      catch { setNotice('下のURLをコピーしてください。'); }
    } catch { setNotice('共有できない入力があります。入力範囲を確認してください。'); }
  };
  const migrated = restore && (restore.sourceVersion !== FISCAL_MODEL_VERSION || restore.filled.length > 0 || restore.clipped.length > 0);
  return <section className="space-y-2 text-sm" aria-label="条件の共有と配分例">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={share}>この条件のURLをコピー</Button>
      <Button variant="outline" size="sm" onClick={() => onPreset({
        ...Object.fromEntries(Object.keys(form.amounts).map(id => [id, 0])),
        'social-insurance': 15,
      })}>例：社会保険料減税だけで15兆円</Button>
      <span data-testid="model-version">モデル {FISCAL_MODEL_VERSION}{calculatedOn && `・計算日 ${calculatedOn}`}</span>
    </div>
    {migrated && <p role="status" data-testid="restore-notice" className="rounded-lg bg-mirai-surface-warm p-2 text-xs">
      共有時のモデル版 {restore.sourceVersion} → 現行 {FISCAL_MODEL_VERSION} で再計算しています。送信者が見た数値と一致しない場合があります。
      {restore.filled.length > 0 && ` 現行の既定値で補完した条件：${restore.filled.join('、')}。`}
      {restore.clipped.length > 0 && ` 入力範囲へ調整した条件：${restore.clipped.join('、')}。`}
    </p>}
    {(error || notice) && <p role="status">{error || notice}</p>}
    {link && <input aria-label="共有URL" className="w-full rounded border p-2" readOnly value={link} onFocus={e => e.target.select()} />}
  </section>;
}
