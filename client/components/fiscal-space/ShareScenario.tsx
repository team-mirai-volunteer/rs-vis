import { useEffect, useState } from 'react';
import type { FiscalForm } from '@/client/lib/fiscal-space-form';
import { encodeScenario, FISCAL_MODEL_VERSION } from '@/client/lib/fiscal-space-url';
import { Button } from '@/components/ui/button';

export function ShareScenario({ form, onPreset, error }: {
  form: FiscalForm; onPreset: (amounts: Record<string, number>) => void; error: string;
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
  return <section className="space-y-2 text-sm" aria-label="条件の共有と配分例">
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={share}>この条件のURLをコピー</Button>
      <Button variant="outline" size="sm" onClick={() => onPreset({
        ...Object.fromEntries(Object.keys(form.amounts).map(id => [id, 0])),
        'social-insurance': 5, rd: 3, grid: 3, defence: 2, childcare: 2,
      })}>例：社会保険料減税中心の15兆円配分</Button>
      <span>モデル {FISCAL_MODEL_VERSION}{calculatedOn && `・計算日 ${calculatedOn}`}</span>
    </div>
    {(error || notice) && <p role="status">{error || notice}</p>}
    {link && <input aria-label="共有URL" className="w-full rounded border p-2" readOnly value={link} onFocus={e => e.target.select()} />}
  </section>;
}
