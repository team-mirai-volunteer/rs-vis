import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '歳入・国民負担（試作）｜行政事業レビュー可視化',
  description: '家族構成・年収別の税と本人保険料、現金給付の参考計算と、国の税目別歳入を確認できます。OECD実出力との照合は未完了です。',
};

export default function TaxBurdenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
