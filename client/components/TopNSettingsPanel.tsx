'use client';

import type { TopNValue } from '@/types/sankey';

interface Props {
  topN: TopNValue;
  onChange: (value: TopNValue) => void;
}

const TOP_N_OPTIONS: TopNValue[] = [5, 10, 20, 50];

export default function TopNSettingsPanel({ topN, onChange }: Props) {
  return (
    <div className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        表示件数:
      </label>
      <div className="flex gap-2">
        {TOP_N_OPTIONS.map((value) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              topN === value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Top {value}
          </button>
        ))}
      </div>
    </div>
  );
}
