import { X } from 'lucide-react';
import { formatYen } from '@/app/lib/subcontract-layout';
import { Button } from '@/components/ui/button';
import { TagChip } from '@/client/components/TagChip';
import { originKindLabel, originKindToTagKind } from '@/client/components/subcontract/origin-kind';
import type { BlockNode, BlockEdge } from '@/types/subcontract';

/**
 * 選択中ブロックのインスペクター（再委託ビューのサイドパネル上部）。
 * 図中ノード選択でこのブロックの詳細（種別・金額・役割・入出フロー）に切り替わり、
 * パンくずで事業の全体表示へ戻る。フローの受入元／再委託先はクリックで当該ブロックへ移動する。
 *
 * ページ側の状態・APIには依存しない純粋な表示コンポーネント（props でデータとコールバックを受ける）。
 * 見た目はチームみらいデザインシステム（.claude/skills/SKILL.md）のトークンに従う。
 */
export function BlockInspector({
  block,
  incoming,
  outgoing,
  blockById,
  onSelectBlock,
  onDeselect,
}: {
  block: BlockNode;
  /** このブロックへ流入するフロー（受入元） */
  incoming: BlockEdge[];
  /** このブロックから流出するフロー（再委託先／別財源へ） */
  outgoing: BlockEdge[];
  blockById: Map<string, BlockNode>;
  onSelectBlock: (block: BlockNode) => void;
  onDeselect: () => void;
}) {
  const FlowLine = ({ label, otherId, note }: { label: string; otherId: string | null; note?: string }) => {
    const other = otherId ? blockById.get(otherId) : null;
    return (
      <div className="flex min-w-0 items-baseline gap-1.5 py-0.5">
        <span className="w-11 shrink-0 text-[10px] text-mirai-text-muted">{label}</span>
        {other ? (
          <Button
            variant="link"
            onClick={() => onSelectBlock(other)}
            title={`${other.blockId} ${other.blockName} を選択`}
            className="min-w-0 justify-start truncate text-left text-[11px] font-normal no-underline hover:text-primary-accent hover:underline"
          >
            {other.blockId} {other.blockName}
          </Button>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-mirai-text-subtle">
            {note || '事業（直接支出）'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="border-b border-border bg-mirai-surface px-4 pb-[11px] pt-[9px]">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="link"
          onClick={onDeselect}
          title="事業の全体表示に戻る (Esc)"
          className="shrink-0 text-[11px] font-bold no-underline hover:text-primary-accent hover:underline"
        >← 事業に戻る</Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDeselect}
          className="size-6 shrink-0 text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text"
          aria-label="選択解除" title="選択解除 (Esc)"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-[5px] flex items-baseline gap-1.5">
        <TagChip kind={originKindToTagKind(block.originKind)}>{originKindLabel(block.originKind)}</TagChip>
        <span title={`${block.blockId} ${block.blockName}`} className="min-w-0 truncate text-[13px] font-bold text-mirai-text">
          <span className="mr-[3px] text-mirai-text-muted">{block.blockId}</span>{block.blockName}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-mirai-text-subtle">
        <span>支出額 <b className="text-mirai-text">{block.totalAmount > 0 ? formatYen(block.totalAmount) : '金額内訳なし'}</b></span>
        <span>支出先 <b className="text-mirai-text">{block.recipientCount.toLocaleString()}件</b></span>
        {block.isTerminal && <span className="text-mirai-text-muted">終端（再委託なし）</span>}
      </div>
      {block.role && (
        <div className="mt-[3px] text-[10.5px] leading-[1.45] text-mirai-text-subtle">役割: {block.role}</div>
      )}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="mt-1.5 border-t border-dashed border-border pt-1.5">
          {incoming.map((f, i) => (
            <FlowLine key={`in-${i}`} label="受入元" otherId={f.sourceBlock} note={f.origin === 'direct' ? '事業（直接支出）' : undefined} />
          ))}
          {outgoing.map((f, i) => (
            <FlowLine key={`out-${i}`} label={f.origin === 'separate-origin' ? '別財源へ' : '再委託先'} otherId={f.targetBlock} />
          ))}
        </div>
      )}
    </div>
  );
}
