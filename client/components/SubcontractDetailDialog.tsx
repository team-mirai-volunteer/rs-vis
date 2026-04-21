'use client';

interface SubcontractProject {
  projectId: number;
  projectName: string;
  amount: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  detail: {
    name: string;
    sourceRecipient: string;
    totalAmount: number;
    flowTypes: string;
    projects: SubcontractProject[];
    furtherOutflows?: { name: string; amount: number; flowType: string }[];
    subcontracts?: { name: string; amount: number; flowType: string }[];
  } | null;
  formatCurrency: (value: number) => string;
}

export default function SubcontractDetailDialog({ isOpen, onClose, detail, formatCurrency }: Props) {
  if (!isOpen || !detail) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 transition-opacity duration-200" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-[90vw] max-w-4xl max-h-[80vh] overflow-y-auto p-6 relative" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
        >
          ✕
        </button>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">再委託先詳細</h2>

        <div className="space-y-6">
          {/* 基本情報 */}
          <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <div className="mb-3">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">再委託先名</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{detail.name}</p>
            </div>
            <div className="mb-3">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">委託元</p>
              <p className="text-md text-gray-900 dark:text-white">{detail.sourceRecipient}</p>
            </div>
            <div className="mb-3">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">資金の流れ</p>
              <p className="text-md text-gray-900 dark:text-white">{detail.flowTypes}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">総額</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">
                {formatCurrency(detail.totalAmount)}
              </p>
            </div>
          </div>

          {/* 再委託先一覧（全体ビュー集約ノード用） */}
          {detail.subcontracts && detail.subcontracts.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                再委託先一覧 ({detail.subcontracts.length}先)
              </h3>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        支出先名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        資金の流れ
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        金額
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {detail.subcontracts.map((sub, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {sub.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {sub.flowType}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(sub.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 関連事業リスト */}
          {detail.projects.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                関連事業 ({detail.projects.length}件)
              </h3>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        事業名
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        金額
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {detail.projects.map((proj, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {proj.projectName}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(proj.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 再々委託先リスト */}
          {detail.furtherOutflows && detail.furtherOutflows.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                再々委託先 ({detail.furtherOutflows.length}件)
              </h3>
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        支出先名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        資金の流れ
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        金額
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {detail.furtherOutflows.map((outflow, idx) => (
                      <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {outflow.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {outflow.flowType}
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(outflow.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 注記（個別再委託先ノードのみ表示） */}
          {!detail.subcontracts && (!detail.furtherOutflows || detail.furtherOutflows.length === 0) && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
              <p className="text-xs text-blue-800 dark:text-blue-300">
                ※ この再委託先からの再々委託先はありません
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
