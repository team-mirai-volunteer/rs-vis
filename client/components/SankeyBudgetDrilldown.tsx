'use client';

import { ResponsiveSankey } from '@nivo/sankey';
import { formatBudgetShort } from '@/client/lib/formatBudget';
import type { SankeyData } from '@/types/sankey';

interface Props {
  data: SankeyData;
}

export default function SankeyBudgetDrilldown({ data }: Props) {
  return (
    <div className="w-full h-[600px]">
      <ResponsiveSankey
        data={data}
        margin={{ top: 40, right: 160, bottom: 40, left: 50 }}
        align="justify"
        colors={{ scheme: 'category10' }}
        nodeOpacity={1}
        nodeHoverOthersOpacity={0.35}
        nodeThickness={18}
        nodeSpacing={24}
        nodeBorderWidth={0}
        nodeBorderColor={{
          from: 'color',
          modifiers: [['darker', 0.8]],
        }}
        nodeBorderRadius={3}
        linkOpacity={0.5}
        linkHoverOthersOpacity={0.1}
        linkContract={3}
        enableLinkGradient={true}
        labelPosition="outside"
        labelOrientation="vertical"
        labelPadding={16}
        labelTextColor={{
          from: 'color',
          modifiers: [['darker', 1]],
        }}
        tooltip={({ node }) => (
          <div className="bg-white dark:bg-gray-800 px-3 py-2 rounded shadow-lg border border-gray-200 dark:border-gray-700">
            <strong className="text-gray-900 dark:text-gray-100">{node.id}</strong>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {formatBudgetShort(node.value)}
            </div>
          </div>
        )}
      />
    </div>
  );
}
