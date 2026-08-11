import { formatYen } from '@/app/lib/subcontract-layout';
import { TagChip } from '@/client/components/TagChip';
import { originKindLabel, originKindToTagKind } from '@/client/components/subcontract/origin-kind';
import type { BlockNode, BlockEdge } from '@/types/subcontract';

const PANEL_BORDER = '#e5e7eb';

/**
 * 選択中ブロックのインスペクター（再委託ビューのサイドパネル上部）。
 * 図中ノード選択でこのブロックの詳細（種別・金額・役割・入出フロー）に切り替わり、
 * パンくずで事業の全体表示へ戻る。フローの受入元／再委託先はクリックで当該ブロックへ移動する。
 *
 * ページ側の状態・APIには依存しない純粋な表示コンポーネント（props でデータとコールバックを受ける）。
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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 0', minWidth: 0 }}>
        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0, width: 44 }}>{label}</span>
        {other ? (
          <button
            onClick={() => onSelectBlock(other)}
            title={`${other.blockId} ${other.blockName} を選択`}
            style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
              fontSize: 11, color: '#1d4ed8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {other.blockId} {other.blockName}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: '#475569', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {note || '事業（直接支出）'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: '9px 16px 11px', background: '#f8fafc', borderBottom: `1px solid ${PANEL_BORDER}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          onClick={onDeselect}
          title="事業の全体表示に戻る (Esc)"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#1d4ed8', fontSize: 11, fontWeight: 600, flexShrink: 0 }}
        >← 事業に戻る</button>
        <button
          onClick={onDeselect}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#64748b', fontSize: 14, flexShrink: 0 }}
          aria-label="選択解除" title="選択解除 (Esc)"
        >✕</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 5 }}>
        <TagChip kind={originKindToTagKind(block.originKind)}>{originKindLabel(block.originKind)}</TagChip>
        <span title={`${block.blockId} ${block.blockName}`} style={{ fontSize: 13, fontWeight: 700, color: '#111827', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#94a3b8', marginRight: 3 }}>{block.blockId}</span>{block.blockName}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#475569', flexWrap: 'wrap' }}>
        <span>支出額 <b style={{ color: '#111827' }}>{block.totalAmount > 0 ? formatYen(block.totalAmount) : '金額内訳なし'}</b></span>
        <span>支出先 <b style={{ color: '#111827' }}>{block.recipientCount.toLocaleString()}件</b></span>
        {block.isTerminal && <span style={{ color: '#94a3b8' }}>終端（再委託なし）</span>}
      </div>
      {block.role && (
        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 3, lineHeight: 1.45 }}>役割: {block.role}</div>
      )}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e2e8f0' }}>
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
