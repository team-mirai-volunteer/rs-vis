import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '財政余力シミュレータ | 政策・物価・供給制約の条件比較',
  description: '政策額・期間・物価上限を変え、入力額の効果と同じ配分の参考上限を比較する条件付きシミュレーション。',
  openGraph: {
    title: '財政余力シミュレータ',
    description: '入力した政策の効果と、仮定に依存する参考上限を比較します。',
    url: 'https://rs-vis.team-mir.ai/fiscal-space',
  },
};

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
