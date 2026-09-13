import { SEMANTIC_PROJECT_SOLID } from '@/app/lib/semantic-colors';

/**
 * 意味タグ（TagChip）の種別と配色。JSX を含まない純粋モジュールとして分離し、
 * 配色コントラストを単体テスト（tag-chip-contrast.test.ts）できるようにしている。
 *
 * - project: 事業（濃緑ソリッド＋白文字。ヘッダの識別タグ）
 * - direct / subcontract / separate-origin: 意味色のソフト配色（淡い背景＋濃い文字）
 * - neutral: 非意味（移替・参考・集計など）は warm neutral グレー（デザインシステムの surface-tag / text-note と同値）
 *
 * 配色は WCAG 4.5:1（通常テキスト）を満たすこと。色源は semantic-colors.ts に対応する。
 */
export type TagKind = 'project' | 'direct' | 'subcontract' | 'separate-origin' | 'neutral';

const SOFT: Record<Exclude<TagKind, 'project'>, { bg: string; fg: string }> = {
  direct: { bg: '#f9dddd', fg: '#b33434' },
  subcontract: { bg: '#faedcf', fg: '#855a0f' },
  'separate-origin': { bg: '#ece5f5', fg: '#5b4483' },
  neutral: { bg: '#e8e8e8', fg: '#4c4c4c' }, // --mirai-surface-tag / --mirai-text-note（warm neutral）
};

/** kind に対応する {bg, fg} を返す（SVG など span を使えない場所向け）。 */
export function tagChipColors(kind: TagKind): { bg: string; fg: string } {
  return kind === 'project' ? { bg: SEMANTIC_PROJECT_SOLID, fg: '#fff' } : SOFT[kind];
}
