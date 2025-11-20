/**
 * 組織階層パス構築ユーティリティ
 */

import type { OrganizationInfo, HierarchyPath } from '@/types/rs-system';

/**
 * 組織情報から階層パスを構築
 * 疎なデータ（府省庁のみ、局・庁まで、など）に対応
 * @param org 組織情報
 * @returns 階層パス
 */
export function buildHierarchyPath(org: OrganizationInfo | Record<string, string>): HierarchyPath {
  return {
    府省庁: (org['府省庁'] || '').trim(),
    '局・庁': (org['局・庁'] || '').trim(),
    部: (org['部'] || '').trim(),
    課: (org['課'] || '').trim(),
    室: (org['室'] || '').trim(),
    班: (org['班'] || '').trim(),
    係: (org['係'] || '').trim(),
  };
}

/**
 * 階層パスの最下層（最も詳細な階層）を取得
 * @param path 階層パス
 * @returns 最下層の名称（係 > 班 > 室 > 課 > 部 > 局・庁 > 府省庁 の優先順位）
 */
export function getLowestLevel(path: HierarchyPath): string {
  if (path.係) return path.係;
  if (path.班) return path.班;
  if (path.室) return path.室;
  if (path.課) return path.課;
  if (path.部) return path.部;
  if (path['局・庁']) return path['局・庁'];
  if (path.府省庁) return path.府省庁;
  return '(階層情報なし)';
}

/**
 * 階層パスを文字列表現に変換
 * @param path 階層パス
 * @returns 階層パス文字列（例: "財務省 > 主計局 > 総務課"）
 */
export function hierarchyPathToString(path: HierarchyPath): string {
  const parts: string[] = [];
  if (path.府省庁) parts.push(path.府省庁);
  if (path['局・庁']) parts.push(path['局・庁']);
  if (path.部) parts.push(path.部);
  if (path.課) parts.push(path.課);
  if (path.室) parts.push(path.室);
  if (path.班) parts.push(path.班);
  if (path.係) parts.push(path.係);
  return parts.join(' > ') || '(階層情報なし)';
}

/**
 * 府省庁名を取得（階層パスから）
 * @param path 階層パス
 * @returns 府省庁名
 */
export function getMinistryName(path: HierarchyPath): string {
  return path.府省庁 || '(不明)';
}
