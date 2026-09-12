'use client';

/**
 * フィルタ解除ボタン。
 *
 * /sankey-svg と同じく、検索セクションの外側に常に置く。幅を確保したまま
 * 非アクティブ時は visibility: hidden にする（表示/非表示でレイアウトが
 * ガタつくのを防ぐ）。
 */

export function HierarchyFilterClearButton({
  active,
  onClear,
}: {
  active: boolean;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white/95 text-gray-500 shadow-md backdrop-blur hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      {/* Material Icons: filter_list_off */}
      <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor">
        <path d="M791-55 55-791l57-57 736 736-57 57ZM633-440l-80-80h167v80h-87ZM433-640l-80-80h487v80H433Zm-33 400v-80h160v80H400ZM240-440v-80h166v80H240ZM120-640v-80h86v80h-86Z" />
      </svg>
    </button>
  );
}
