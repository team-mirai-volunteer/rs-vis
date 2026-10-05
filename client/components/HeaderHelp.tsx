'use client';

/**
 * ヘッダーの「説明」ボタンと、その下に浮かせて出す説明パネル。サンキー図・バブルチャート・評価一覧・委託構造で共通。
 * パネルはボタンの右端に揃えて下に出す（画面の右端に寄せない）。外側クリック・Esc で閉じる。
 */
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function HeaderHelp({ id, label, children }: {
  id: string;
  /** パネルの読み上げ名（例: 「この図の説明」） */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <div className="relative shrink-0">
    <Button variant="outline" size="sm" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-controls={id}
      className="h-9 shrink-0 border-mirai-border px-2.5 text-xs font-medium text-mirai-text-subtle hover:text-mirai-text">説明</Button>
    {open && <>
      <div className="fixed inset-0 z-[230]" onClick={() => setOpen(false)} aria-hidden="true" />
      <div id={id} role="dialog" aria-label={label} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
        className="absolute right-0 top-full z-[240] mt-2 max-h-[calc(100dvh-var(--app-header-h)-24px)] w-[26rem] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-mirai-border bg-card p-3.5 text-xs leading-relaxed shadow-soft">
        {children}
      </div>
    </>}
  </div>;
}
