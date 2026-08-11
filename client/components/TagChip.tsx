import type { CSSProperties, ReactNode } from 'react';
import { tagChipColors, type TagKind } from './tag-chip-colors';

export { tagChipColors, type TagKind };

/**
 * 意味タグの共有プリミティブ。メインSankey（/sankey-svg）と再委託ビュー（/subcontracts）で
 * 同じ意味には同じ見た目のピルを出すために使う。配色は tag-chip-colors.ts（純粋モジュール）に集約。
 *
 * 色単独判別に依存させないため、必ず children に意味語（直接/再委託/別財源 等）を含めること。
 */
export function TagChip({
  kind,
  children,
  fontSize = 10,
  style,
}: {
  kind: TagKind;
  children: ReactNode;
  /** 呼び出し側のフォントスケールに合わせる（既定10px） */
  fontSize?: number;
  style?: CSSProperties;
}) {
  const { bg, fg } = tagChipColors(kind);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        fontWeight: 700,
        padding: '1px 7px',
        fontSize,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        background: bg,
        color: fg,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
