import { redirect } from 'next/navigation';
import { sankeySvgSearchToUnified } from '@/app/lib/unified-budget/links';

/**
 * 旧サンキー図（/sankey-svg）は統合ビュー（/budget-sankey）に統合された。
 * 外部に共有された URL が生き続けるよう、旧パラメータ（yr / sel / pp / tp / fm / fnp …）を
 * 統合ビューの語彙へ写してリダイレクトする（写像は app/lib/unified-budget/links.ts）。
 */
export default async function SankeySvgRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  redirect(`/budget-sankey?${sankeySvgSearchToUnified(params)}`);
}
