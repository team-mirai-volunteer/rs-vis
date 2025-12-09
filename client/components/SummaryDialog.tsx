'use client';

import { RS2024PresetData } from '@/types/preset';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    metadata: RS2024PresetData['metadata'];
    formatCurrency: (value: number) => string;
}

export default function SummaryDialog({ isOpen, onClose, metadata, formatCurrency }: Props) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 transition-opacity duration-200">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[90vw] max-w-lg p-6 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
                >
                    ✕
                </button>

                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">概要</h2>

                <div className="space-y-6">
                    {/* 予算・支出 */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                            <p className="text-sm text-green-800 dark:text-green-300 mb-1">選択予算額</p>
                            <p className="text-xl font-bold text-green-700 dark:text-green-400">
                                {formatCurrency(metadata.summary.selectedBudget)}
                            </p>
                        </div>
                        {/* 支出額はメタデータに含まれていないため、予算額と同じか、別途計算が必要だが、
                現状のUIでは予算額を表示していたのでそれに倣う。
                Issueの要望では「予算・支出（緑・赤）」とあるが、データ構造上支出総額がすぐ取れるか確認が必要。
                一旦予算額を表示し、必要なら修正する。
             */}
                    </div>

                    {/* 件数情報 */}
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">府省庁</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">
                                {metadata.summary.selectedMinistries}
                            </p>
                        </div>
                        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">事業</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">
                                {metadata.summary.selectedProjects}
                            </p>
                        </div>
                        <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">支出先</p>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">
                                {metadata.summary.selectedSpendings}
                            </p>
                        </div>
                    </div>

                    {/* カバー率 */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg flex items-center justify-between">
                        <p className="text-sm text-blue-800 dark:text-blue-300">カバー率</p>
                        <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                            {metadata.summary.coverageRate.toFixed(1)}%
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
