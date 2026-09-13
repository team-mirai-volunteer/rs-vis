/**
 * E2E 用の `data-testid` を、開発とテスト実行時にだけ付ける。
 *
 * 本番バンドルに出さないのは、テストの都合で付けた目印が公開物の一部に
 * 見えてしまうと、消してよいのか分からなくなるため。
 * 逆に本番ビルドに対して Playwright を流す CI では
 * `NEXT_PUBLIC_PLAYWRIGHT=1` を立てて有効にする。
 */
export const E2E_TEST_IDS_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_PLAYWRIGHT === '1';

export const testId = (id: string): string | undefined =>
  E2E_TEST_IDS_ENABLED ? id : undefined;
