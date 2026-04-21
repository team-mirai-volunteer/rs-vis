'use client';

import { useEffect, useState } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';
import type { MOFBudgetData } from '@/types/mof-budget-overview';
import type { SankeyNode } from '@/types/sankey';
import { generateTransferDetailSankey } from '@/app/lib/mof-transfer-sankey-generator';

/**
 * 一般会計から特別会計への繰入詳細ページ
 */
export default function TransferDetailPage() {
  const [data, setData] = useState<MOFBudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/mof-budget-overview-2023.json')
      .then((res) => {
        if (!res.ok) throw new Error('データの読み込みに失敗しました');
        return res.json();
      })
      .then((jsonData: MOFBudgetData) => {
        setData(jsonData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center text-red-600">
          <p className="text-xl font-bold mb-2">エラー</p>
          <p>{error || 'データが見つかりません'}</p>
        </div>
      </div>
    );
  }

  const sankeyData = generateTransferDetailSankey(data);

  // 金額フォーマット
  const formatAmount = (value: number): string => {
    const trillion = value / 1e12;
    if (trillion >= 1) {
      return `${trillion.toFixed(2)}兆円`;
    }
    const billion = value / 1e9;
    if (billion >= 1) {
      return `${billion.toFixed(0)}億円`;
    }
    return `${(value / 1e6).toFixed(0)}百万円`;
  };

  // ノードの色分け
  const getNodeColor = (node: SankeyNode): string => {
    // Column 1: 財源詳細
    if (node.type === 'transfer-detail') {
      return '#81c784'; // 一般会計繰入詳細: 緑
    }
    if (node.type === 'insurance-detail') {
      return '#9c27b0'; // 社会保険料詳細: 紫
    }

    // Column 2: 財源カテゴリ
    if (node.type === 'revenue-category') {
      if (node.id === 'category-transfer') return '#66bb6a'; // 一般会計繰入: 濃緑
      if (node.id === 'category-insurance') return '#7b1fa2'; // 社会保険料: 濃紫
      if (node.id === 'category-bonds') return '#ff9800'; // 公債金: オレンジ
      if (node.id === 'category-other-transfer') return '#90caf9'; // 他会計繰入: 青
      return '#bdbdbd'; // その他収入: グレー
    }

    // Column 3: 特別会計総額
    if (node.type === 'account-total') {
      return '#1976d2'; // 特別会計: 濃青
    }

    return '#e0e0e0'; // デフォルト: グレー
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* ヘッダー */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-center gap-4 mb-4">
          <a
            href="/mof-budget-overview"
            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            ← 全体ビューに戻る
          </a>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          特別会計 財源内訳
        </h1>
        <p className="text-gray-600">
          特別会計443.43兆円の財源（一般会計繰入、社会保険料、公債金等）を可視化
        </p>
      </div>

      {/* サマリーカード */}
      <div className="max-w-7xl mx-auto mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">特別会計総額</h3>
          <p className="text-2xl font-bold text-blue-600">
            {formatAmount(data.specialAccount.total)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">一般会計繰入</h3>
          <p className="text-2xl font-bold text-green-600">
            {typeof data.specialAccount.revenue.transferFromGeneral === 'number'
              ? formatAmount(data.specialAccount.revenue.transferFromGeneral)
              : formatAmount(data.specialAccount.revenue.transferFromGeneral.totalIncludingDebt)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">社会保険料</h3>
          <p className="text-2xl font-bold text-purple-600">
            {typeof data.specialAccount.revenue.insurancePremiums === 'object' && 'total' in data.specialAccount.revenue.insurancePremiums
              ? formatAmount(data.specialAccount.revenue.insurancePremiums.total)
              : '0円'}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-600 mb-2">公債金</h3>
          <p className="text-2xl font-bold text-orange-600">
            {formatAmount(data.specialAccount.revenue.publicBonds)}
          </p>
        </div>
      </div>

      {/* サンキー図 */}
      <div className="max-w-7xl mx-auto bg-white rounded-lg shadow-lg p-6">
        <div style={{ height: '800px' }}>
          <ResponsiveSankey
            data={sankeyData}
            margin={{ top: 40, right: 200, bottom: 40, left: 200 }}
            align="justify"
            colors={getNodeColor}
            nodeOpacity={1}
            nodeHoverOthersOpacity={0.35}
            nodeThickness={42}
            nodeSpacing={24}
            nodeBorderWidth={0}
            nodeBorderRadius={3}
            linkOpacity={0.5}
            linkHoverOthersOpacity={0.1}
            linkBlendMode="multiply"
            enableLinkGradient={true}
            label={(node) => `${node.id}`}
            nodeTooltip={({ node }) => (
              <div className="bg-white px-3 py-2 rounded shadow-lg border border-gray-200 min-w-[240px]">
                <div className="font-semibold text-gray-900">
                  {(node as SankeyNode & { name?: string }).name || node.id}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  {formatAmount(node.value || 0)}
                </div>
              </div>
            )}
            layers={[
              'links',
              'nodes',
              'legends',
              // カスタムレイヤーで金額と名前を表示
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ({ nodes }: any) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return nodes.map((node: any) => {
                  const actualNode = sankeyData.nodes.find((n) => n.id === node.id) as SankeyNode & { name?: string };
                  const name = actualNode?.name || node.id;
                  const amount = formatAmount(node.value || 0);

                  // ノードタイプに基づいてラベル位置を決定
                  const isLeftColumn = node.type === 'general-expenditure';
                  const isMiddleColumn = node.type === 'special-account';

                  const textX = isLeftColumn ? node.x - 8 : node.x + node.width + 8;
                  const textAnchor = isLeftColumn ? 'end' : 'start';

                  // 金額ラベル（上）
                  const amountX = node.x + node.width / 2;

                  return (
                    <g key={node.id}>
                      {/* 金額ラベル */}
                      <text
                        x={amountX}
                        y={node.y - 8}
                        textAnchor="middle"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          fill: '#1f2937',
                          pointerEvents: 'none',
                        }}
                      >
                        {amount}
                      </text>

                      {/* 名前ラベル */}
                      <text
                        x={textX}
                        y={node.y + node.height / 2}
                        textAnchor={textAnchor}
                        dominantBaseline="middle"
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          fill: '#1f2937',
                          pointerEvents: 'none',
                        }}
                      >
                        {name}
                      </text>
                    </g>
                  );
                });
              },
            ]}
          />
        </div>
      </div>

      {/* 説明セクション */}
      <div className="max-w-7xl mx-auto mt-6 bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">図の見方</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">Column 1: 財源詳細（左）</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• <span className="text-green-600">一般会計繰入の内訳</span>: 年金特会へ、交付税へ等</li>
              <li>• <span className="text-purple-600">社会保険料の内訳</span>: 年金保険料、労働保険料等</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-2">Column 2: 財源カテゴリ（中）</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• <span className="text-green-700">一般会計繰入</span>: 58.06兆円</li>
              <li>• <span className="text-purple-700">社会保険料</span>: 50.17兆円</li>
              <li>• <span className="text-orange-600">公債金（借換債）</span>: 165.12兆円</li>
              <li>• <span className="text-blue-600">他会計繰入</span>: 81.32兆円</li>
              <li>• <span className="text-gray-600">その他収入</span>: 114.31兆円</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-2">Column 3: 特別会計（右）</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• <span className="text-blue-800">特別会計総額</span>: 443.43兆円</li>
              <li className="mt-2 pt-2 border-t">すべての財源が右側の特別会計に流入</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t">
          <h3 className="font-semibold text-gray-700 mb-2">主要な財源</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-start">
              <span className="text-2xl mr-2">1️⃣</span>
              <div>
                <p className="font-semibold">公債金（借換債）165.12兆円</p>
                <p className="text-gray-600">既存国債の借り換えのための新規国債発行</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="text-2xl mr-2">2️⃣</span>
              <div>
                <p className="font-semibold">その他収入 114.31兆円</p>
                <p className="text-gray-600">特別会計の自主財源等</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="text-2xl mr-2">3️⃣</span>
              <div>
                <p className="font-semibold">他会計繰入 81.32兆円</p>
                <p className="text-gray-600">特別会計間の繰入</p>
              </div>
            </div>
            <div className="flex items-start">
              <span className="text-2xl mr-2">4️⃣</span>
              <div>
                <p className="font-semibold">一般会計繰入 58.06兆円</p>
                <p className="text-gray-600">一般会計から特別会計への繰入（国債整理基金25.25兆円含む）</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
