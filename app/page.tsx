import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <main className="max-w-4xl w-full">
        <h1 className="text-4xl font-bold text-center mb-4 text-gray-900 dark:text-gray-100">
          行政事業レビュー サンキー図
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-12">
          行政事業レビューシステムの予算・支出データを可視化
        </p>

        <div className="grid grid-cols-1 gap-6">
          {/* インタラクティブサンキー図 */}
          <Link href="/sankey">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-blue-500">
              <h2 className="text-2xl font-semibold mb-3 text-blue-600 dark:text-blue-400">
                📊 インタラクティブサンキー図
              </h2>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                予算総計 → 府省庁（予算） → 事業（予算） → 事業（支出） → 支出先の5列フローを動的に可視化します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>府省庁ビュー</strong>: 府省庁ノードをクリックで詳細表示</li>
                <li>• <strong>事業ビュー</strong>: 事業ノードをクリックで支出先を詳細表示</li>
                <li>• <strong>支出ビュー</strong>: 支出先ノードをクリックで支出元（事業・府省庁）を逆向き表示</li>
                <li>• TopN設定: 各ビューごとに表示数を調整可能（デフォルト: 全体3、詳細10）</li>
                <li>• カバー率: 約50%（73.58兆円 / 146.63兆円）</li>
              </ul>
            </div>
          </Link>

          {/* 直接支出サンキー図 SVG版 */}
          <Link href="/sankey-svg">
            <div className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900 dark:to-red-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-orange-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-orange-600 dark:text-orange-400">
                  🔍 直接支出サンキー図（SVG）
                </h2>
                <span className="ml-3 px-2 py-1 bg-orange-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                直接支出先のみを対象に、自前SVGレイアウトエンジンで高速描画。支出先ウィンドウのスライドで任意のランキング帯を探索できます。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>支出先ウィンドウ</strong>: オフセットスライダーで任意の順位帯を選択</li>
                <li>• <strong>動的再ランキング</strong>: スライダー変化に合わせて府省庁・事業を再集計</li>
                <li>• <strong>ズーム/パン</strong>: ホイールズーム（最大50x）＋ドラッグパン</li>
                <li>• <strong>ミニマップ</strong>: 全体俯瞰ナビゲーション</li>
              </ul>
            </div>
          </Link>

          {/* MOF予算全体ビュー（NEW） */}
          <Link href="/mof-budget-overview">
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900 dark:to-pink-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-purple-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-purple-600 dark:text-purple-400">
                  🏛️ MOF予算全体ビュー
                </h2>
                <span className="ml-3 px-2 py-1 bg-purple-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                財務省予算総額（556.3兆円）とRS対象範囲（151.1兆円）を財源詳細から支出先まで一貫して可視化します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>財源詳細</strong>: 租税を税目別に分解（消費税、所得税、法人税等）</li>
                <li>• <strong>予算の流れ</strong>: 財源 → 会計区分 → RS対象区分 → 詳細内訳 → RS集約</li>
                <li>• <strong>RS対象率</strong>: 全体27.2%（一般会計63.4%、特別会計17.8%）</li>
                <li>• <strong>誤解防止</strong>: 国債費・地方交付税等の制度的支出を明示</li>
                <li>• データ年度: 2023年度（令和5年度）当初予算</li>
              </ul>
            </div>
          </Link>
          {/* 予算フローマップ（NEW） */}
          <Link href="/sankey2">
            <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900 dark:to-blue-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-indigo-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">
                  🗺️ 予算フローマップ
                </h2>
                <span className="ml-3 px-2 py-1 bg-indigo-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                事業・支出先をGoogle Maps風のZoom/Panで自由に探索。Treemapクラスタで面積∝金額の直感的なSVGフロー可視化。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>全量表示</strong>: 全ノード・エッジを事前計算レイアウトで描画</li>
                <li>• <strong>Zoom/Pan</strong>: ホイールでズーム、ドラッグでパン</li>
                <li>• <strong>面積ベースLOD</strong>: ズームに応じてノード・ラベルが連続的に出現</li>
                <li>• <strong>ハイライト</strong>: ノードホバーで接続フローをハイライト</li>
              </ul>
            </div>
          </Link>

          {/* 支出先ブラウザ（NEW） */}
          <Link href="/entities">
            <div className="bg-gradient-to-r from-green-50 to-teal-50 dark:from-green-900 dark:to-teal-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-green-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-green-600 dark:text-green-400">
                  🏢 支出先ブラウザ
                </h2>
                <span className="ml-3 px-2 py-1 bg-green-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                全支出先 26,000件以上を種別・金額でブラウズ。エンティティ種別（民間企業・地方公共団体・独立行政法人 等）ごとの集計や検索が可能です。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>種別フィルタ</strong>: 民間企業・地方公共団体・国の機関・独立行政法人・公益法人・NPO・外国法人</li>
                <li>• <strong>名称検索</strong>: 支出先名のインクリメンタル検索</li>
                <li>• <strong>Sankey連携</strong>: 各支出先からサンキー図にジャンプ</li>
                <li>• <strong>支店・親会社</strong>: 支店エントリは親会社を表示</li>
              </ul>
            </div>
          </Link>

          {/* 事業別データ品質スコア */}
          <Link href="/quality">
            <div className="bg-gradient-to-r from-cyan-50 to-sky-50 dark:from-cyan-900 dark:to-sky-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-cyan-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-cyan-600 dark:text-cyan-400">
                  📋 事業別データ品質スコア
                </h2>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                全事業の支出先データ品質を5軸でスコア化。府省庁・組織階層別にフィルタ・ソート・検索して改善優先度を確認できます。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>軸1 支出先名品質</strong>: 法人番号DB突合による valid 率（重み40%）</li>
                <li>• <strong>軸2 法人番号記入率</strong>: CN の記入カバレッジ（重み20%）</li>
                <li>• <strong>軸3 予算・支出バランス</strong>: 執行額と支出先合計の乖離率（重み20%）</li>
                <li>• <strong>軸4/5</strong>: ブロック構造・支出先名の透明性（各重み10%）</li>
              </ul>
            </div>
          </Link>

          {/* 再委託構造ブラウザ */}
          <Link href="/subcontracts">
            <div className="bg-gradient-to-r from-teal-50 to-cyan-50 dark:from-teal-900 dark:to-cyan-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-teal-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-teal-600 dark:text-teal-400">
                  🔗 再委託構造ブラウザ
                </h2>
                <span className="ml-3 px-2 py-1 bg-teal-600 text-white text-xs font-bold rounded">
                  NEW
                </span>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                事業ごとのブロック間フロー（再委託構造）を自前SVGで可視化。担当組織→直接ブロック→再委託ブロックの階層をDAGで表示します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>再委託階層</strong>: ブロック間フローの最大深さを一覧で確認</li>
                <li>• <strong>DAG描画</strong>: Fan-In/Fan-Outを含む再委託構造をSVGで表示</li>
                <li>• <strong>支出先詳細</strong>: 契約概要・費目・使途をパネルで確認</li>
                <li>• <strong>sankey-svg連携</strong>: 事業選択時から直接ジャンプ可能</li>
              </ul>
            </div>
          </Link>

          {/* 支出先ラベリング確認 */}
          <Link href="/entity-labels-csv">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900 dark:to-amber-900 rounded-lg shadow-lg p-8 hover:shadow-xl transition-shadow cursor-pointer border-2 border-transparent hover:border-orange-500">
              <div className="flex items-center mb-3">
                <h2 className="text-2xl font-semibold text-orange-600 dark:text-orange-400">
                  🏷️ 支出先ラベリング確認
                </h2>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-4">
                元CSVから直接抽出した支出先名に対して、辞書・格パターンでラベリングした結果を確認します。
              </p>
              <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <li>• <strong>L1/L2 分類</strong>: 民間企業・公益法人・地方公共団体・国の機関 等19区分</li>
                <li>• <strong>ソース表示</strong>: 辞書マッチ・格パターン・両方・未ラベルで判別</li>
                <li>• <strong>件数カバレッジ</strong>: 約80.1%</li>
                <li>• <strong>金額カバレッジ</strong>: 約98%（金額上位が辞書でカバー済み）</li>
              </ul>
            </div>
          </Link>
        </div>

        <footer className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>データソース: <a href="https://rssystem.go.jp/download-csv" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-600">行政事業レビューシステム</a></p>
        </footer>
      </main>
    </div>
  );
}
