import type { BlockOriginKind, FlowOrigin } from '@/types/subcontract';
import type { TagKind } from '@/client/components/tag-chip-colors';

/** ブロックの起点種別の表示ラベル（別財源の broad/strong は一律「別財源」） */
export function originKindLabel(kind: BlockOriginKind): string {
  switch (kind) {
    case 'direct': return '直接';
    case 'subcontract': return '再委託';
    case 'separate-origin-strong':
    case 'separate-origin-broad':
      return '別財源';
  }
}

/** ブロックの originKind を共有 TagChip の kind に変換する（別財源の broad/strong は一律 separate-origin） */
export function originKindToTagKind(kind: BlockOriginKind): TagKind {
  return kind === 'direct' ? 'direct' : kind === 'subcontract' ? 'subcontract' : 'separate-origin';
}

/** フローの origin を共有 TagChip の kind に変換する（移替・参考は意味色を持たせずグレー） */
export function flowOriginToTagKind(origin: FlowOrigin): TagKind {
  switch (origin) {
    case 'direct': return 'direct';
    case 'subcontract': return 'subcontract';
    case 'separate-origin': return 'separate-origin';
    case 'transfer':
    case 'reference':
      return 'neutral';
  }
}
