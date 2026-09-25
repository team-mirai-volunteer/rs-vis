'use client';

import { Button } from '@/components/ui/button';

export default function FiscalSpaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto max-w-2xl space-y-4 p-8" role="alert">
    <h1 className="text-xl font-bold">この条件では計算を続けられません</h1>
    <p>入力がモデルの計算範囲を超えたか、読み込みに失敗しました。入力を戻して再試行してください。</p>
    <Button variant="outline" onClick={reset}>再試行する</Button>
    <a href="/fiscal-space" className="ml-4 text-sm font-medium text-primary-accent underline underline-offset-4">共有条件を解除して初期状態に戻す</a>
  </main>;
}
