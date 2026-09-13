'use client';

/**
 * フィルタ解除ボタン。
 *
 * /sankey-svg と同じく、検索セクションの外側に常に置く。幅を確保したまま
 * 非アクティブ時は visibility: hidden にする（表示/非表示でレイアウトが
 * ガタつくのを防ぐ）。
 */

import { FilterX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HierarchyFilterClearButton({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClear}
      title="フィルタを解除"
      aria-label="フィルタを解除"
      aria-hidden={!active}
      tabIndex={active ? 0 : -1}
      data-pan-disabled="true"
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
      className="shrink-0 border-mirai-border bg-card text-mirai-text-muted hover:bg-card"
    >
      <FilterX className="size-[18px]" aria-hidden="true" />
    </Button>
  );
}
