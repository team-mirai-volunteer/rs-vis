import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="max-w-4xl w-full">
        <h1 className="text-4xl font-bold text-center mb-4 text-gray-900 dark:text-gray-100">
          RS2024 サンキー図
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-12">
          2024年度 行政事業レビューシステムの予算・支出データを可視化
        </p>

        <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
          {/* サンキー図（Top3） */}
          <Link href="/sankey">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
              <h2 className="text-2xl font-semibold mb-3 text-blue-600 dark:text-blue-400">
                📊 サンキー図（Top3）
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                府省庁 → 事業 → 支出先の予算フローを再帰的Top3選択で可視化します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• Top3府省庁 × 各府省庁のTop3事業 × 各事業のTop3支出先</li>
                <li>• カバー率: 約50%（全予算の半分を可視化）</li>
                <li>• 軽量プリセット（14KB）で高速表示</li>
              </ul>
            </div>
          </Link>
        </div>

        <footer className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>データソース: <a href="https://rssystem.go.jp/download-csv/2024" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">行政事業レビューシステム (2024年度)</a></p>
        </footer>
      </main>
    </div>
  );
}
