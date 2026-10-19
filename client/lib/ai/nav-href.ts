/**
 * AI ナビの navigate_page の応答（navigate）から、実際に開く URL を組み立てる。
 *
 * - サンキー図: 条件（result）を絞り込み URL に写す（result-links.ts）
 * - 財政余力: 既定の条件に AI が指定した政策の年額を重ね、ページと同じ符号化で URL ハッシュに入れる
 * - それ以外: サーバーが組んだ href をそのまま使う
 * 純関数（React・fetch なし）。
 */
import type { SankeyChatResponse, SankeyChatResult } from '@/types/sankey-ai-chat';
import { defaults } from '@/client/lib/fiscal-space-form';
import { encodeScenario } from '@/client/lib/fiscal-space-url';
import { sankeyUrlForQuery } from '@/client/lib/ai/result-links';

export function navigateHref(navigate: NonNullable<SankeyChatResponse['navigate']>, result: SankeyChatResult | undefined, yearKey: string): string {
  if (navigate.key === 'sankey' && result) return sankeyUrlForQuery(result.query, yearKey);
  if (navigate.key === 'fiscal-space' && navigate.scenario) {
    // フォームの amounts は兆円単位（画面の入力と同じ）。AI は円で渡してくるので換算し、小数 3 桁（10 億円）に丸める
    const form = defaults();
    for (const [id, yen] of Object.entries(navigate.scenario.amounts)) {
      if (Object.hasOwn(form.amounts, id)) form.amounts[id] = Math.min(100, Math.round(yen / 1e9) / 1e3);
    }
    try { return `${navigate.href}${encodeScenario(form)}`; }
    catch { return navigate.href; }
  }
  return navigate.href;
}

/** 同じページ内の移動か（パスが同じなら、ページを作り直さず URL だけ替えて popstate で知らせる） */
export function samePath(href: string, pathname: string): boolean {
  const path = href.split(/[?#]/)[0];
  return path === pathname;
}
