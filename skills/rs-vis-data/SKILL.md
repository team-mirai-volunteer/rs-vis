---
name: rs-vis-data
description: 日本の国の予算・行政事業レビュー（RS）のデータを、行政事業レビュー可視化サイト（rs-vis）の MCP サーバーから引いて答える。事業・支出先・再委託・AI 評価・年度比較・注目事業（1者応札、支出集中、不用率など）を調べたいとき、国の事業の予算額・執行額・支出先を聞かれたとき、「この省庁で○○な事業」「この会社が受注している事業」「予算が余っている事業」のような問いに使う。
---

# rs-vis のデータを MCP で引く

行政事業レビュー可視化サイト（https://rs-vis.team-mir.ai）は、日本の国の 2024 年度の予算・執行・支出先（5,003 事業、26,823 支出先）を、
行政事業レビュー見える化サイト（内閣官房）と財務省の予算書・決算書データベースから編集・加工して公開している。
このスキルは、そのデータを MCP サーバー経由でツールとして引き、根拠つきで答えるための手順。

## 準備（1 回だけ）

```bash
claude mcp add --transport http rs-vis https://rs-vis.team-mir.ai/api/mcp
# ローカルで動かしているとき
claude mcp add --transport http rs-vis-local http://localhost:3000/api/mcp
```

認証なし・公開データのみ。サーバーは LLM を呼ばない（ツールの実行だけ）。

## データの約束事（答える前に必ず押さえる）

| 事項 | 内容 |
|---|---|
| 金額 | すべて **1 円単位**。「100 億円」= 10000000000。千円単位ではない |
| 年度 `year` | RS の **シート年度**。`"2025"` には 2024 年度の執行・支出先が載る（シート年度 = 実績年度 + 1）。対応は `"2024"` と `"2025"`。省略時は `"2024"` |
| 対象範囲 | 行政事業レビューの対象事業のみ（国の全予算の約 27%）。国債費・地方交付税・年金給付などは含まない |
| 「その他」 | 支出先名が文字どおり「その他」と報告された支出（約 26 兆円）。**「その他の支出先」** は上位 N 件以外の集計ノード（約 51 兆円）。別物 |
| 同じ支出先が複数ブロックに出る | 金額は合算して扱う（1 件目だけ見ない） |
| AI 評価 | 公開資料に基づく独自基準の **試行**。政府の公式評価ではなく、見直し候補は結論ではなくスクリーニング結果。断定しない |
| 出典 | 数字を示すときは「行政事業レビュー見える化サイト（内閣官房）、財務省 予算書・決算書データベース ほか。チームみらい 行政事業レビュー可視化（https://rs-vis.team-mir.ai）が編集・加工」と明記する |

## 問いの種類で進め方を切り替える

聞き方で 2 つのモードを使い分ける。サイト内の AI ナビ（`app/lib/ai/chat-core.ts` のシステムプロンプト）と同じ分け方。

| モード | 聞き方の例 | やること | 答え方 |
|---|---|---|---|
| **A. 絞り込み（事業の集合を求める）** | 「〜の事業」「〜な事業を探して／見せて」「○○省で予算 100 億円以上」「再委託がある事業」「怪しい／気になる事業」 | 条件を `run_sankey_query` の `query` に翻訳し、件数と金額を確かめる。名前や金額で表せない基準（支出先の集中、低評価×高予算、不用率）は `get_highlights` で pid を集めて条件にする | 件数・予算合計・上位 10 件を示し、条件をどう解釈したかを 1 文添える。サイトで同じ条件を開く URL（下記「事業名で絞ったサンキー図」の形）を付ける |
| **B. 内容・評価の問い合わせ（特定の事業・支出先について知りたい）** | 「この事業は何をしている？」「○○事業の予算と執行は？」「評価が低い理由は？」「△△が受注しているのは？」「去年から増えた？」「〜にいくら使われている？」 | `search_projects` → `get_project_detail` / `get_quality_scores` / `get_subcontract_chain` / `get_recipient_detail` / `compare_years` / `search_spending` で値を取り、ツール応答から転記する | 数字は必ずツール応答から。評価は「レビューシートの記載としては〜」と言い、良し悪しを断定しない。直接支出と再委託は分けて述べる |

- 両方を含む問い（「子育て支援の事業を探して、一番大きいものの中身を教えて」）は A → B の順で進める。
- どちらにも当てはまらない問い（雑談、データに無い切り口）はツールを呼ばず、聞ける質問の例を返す。
- 条件で表せないもの（「評価が低い事業だけ」）は、`get_highlights` の `lowScoreHighBudget` や `get_quality_scores` で近似するか、できない旨を正直に言う。

## ツールの使い分け

| 知りたいこと | ツール | 主な引数 |
|---|---|---|
| 名前から事業を探す | `search_projects` | `q`（事業名の部分一致）、`scope: "details"` で概要文も対象 |
| 支出先（会社・団体）を探す | `search_recipients` | `q` |
| 役割・契約概要の文章で探す（「システム改修」「調査研究」など） | `search_spending` | `q`（2 文字以上） |
| 事業の中身（目的・現状課題・概要・予算・執行・支出合計・総合点・開始年度・実施方法） | `get_project_detail` | `pid` |
| AI 評価の内訳（4 軸・執行透明性・推奨判断） | `get_quality_scores` | `pids`（最大 10 件） |
| ある支出先が受注している事業の一覧（直接支出・再委託の内訳） | `get_recipient_detail` | `key`（`search_recipients` の結果の `corporateNumber`。無ければ名称） |
| 再委託の連鎖（誰が誰に委託したか） | `get_subcontract_chain` | `pid` |
| 注目事業（指標別の上位） | `get_highlights` | `metric`: `spendingChange` 支出の増減 / `otherRatio` 「その他」比率 / `concentration` 支出先の集中 / `lowScoreHighBudget` 低評価×高予算 / `execBudgetGap` 予算と執行の乖離 / `subcontractDepth` 再委託の深さ |
| 条件に合う事業の件数・金額・上位（府省・名前・金額・再委託・支出先） | `run_sankey_query` | `query`（下記） |
| 条件に合う事業の年度間比較 | `compare_years` | `query`、`baseYear`、`compareYear` |

`run_sankey_query` の `query` は次の形（条件は AND）。

```json
{
  "year": "2025",
  "filter": {
    "projectName": { "query": "子育て|こども|保育", "regex": true },
    "recipientName": { "query": "市|町|村|県", "regex": true, "includeSubcontract": false },
    "ministries": ["こども家庭庁"],
    "budget": { "min": 10000000000, "max": null },
    "spending": { "min": null, "max": null },
    "accountCategories": ["general"],
    "subcontract": { "hasRedelegation": true, "minDepth": null }
  }
}
```

どの項目も省略可。金額は円。`ministries` は府省庁名の完全一致なので、`get_project_detail` などの結果に出る正式名を使う（「文科省」ではなく「文部科学省」）。

## 進め方

1. **候補を探す**: `search_projects` / `search_recipients` / `search_spending` で当たりをつける。ヒットが 0 件なら言い換える（「再エネ」→「再生可能エネルギー」、略称 → 正式名）。
2. **深掘りする**: `get_project_detail` で予算・執行・支出先を、`get_subcontract_chain` で再委託を、`get_quality_scores` で評価を見る。
3. **条件で確かめる**: 「○○省で予算 100 億円以上」のような問いは `run_sankey_query` で件数と金額を確定させる。0 件なら条件を緩める。
4. **答える**: 数字は 1 円単位から億円・兆円に直し（1 億円 = 100,000,000）、事業名・事業 ID・年度・出典を添える。サイトで確かめられる URL を付ける。

## サイトの URL（答えに添える）

| 見せたいもの | URL |
|---|---|
| 事業の詳細（評価一覧のダイアログ） | `https://rs-vis.team-mir.ai/quality?fiscalYear=2024&detail={pid}` |
| 事業の委託構造 | `https://rs-vis.team-mir.ai/subcontracts/{pid}?fiscalYear=2024` |
| 事業をサンキー図で（府省 → 事業 → 支出先） | `https://rs-vis.team-mir.ai/budget-sankey?year=2024&cols=mi,pr,ps,re&fnrs=0&sel=project-budget-{pid}&fr=1` |
| 事業名で絞ったサンキー図 | `https://rs-vis.team-mir.ai/budget-sankey?year=2024&cols=mi,pr,ps,re&fnrs=0&fpq={事業名}&ffp=1` |
| 支出先名で絞ったサンキー図 | `https://rs-vis.team-mir.ai/budget-sankey?year=2024&cols=mi,pr,ps,re&fnrs=0&frq={支出先名}&ffp=1` |

`fiscalYear` / `year` は実績年度（2024）。シート年度 `"2025"` のデータに対応する。

## 典型的な問いと手順

- **「○○省で予算 100 億円以上の事業は」**: `run_sankey_query` で `ministries` と `budget.min` を指定 → 件数・予算合計・上位 10 件が返る → 気になる事業を `get_project_detail`。
- **「株式会社△△が受注している事業」**: `search_recipients` で `corporateNumber` を取り、`get_recipient_detail`。同じ法人が複数の表記で載ることがあるので、候補を複数見る。
- **「予算が余っている事業」**: `get_highlights` の `execBudgetGap`。不用額は返納として適切な行動でもあるので、見直すのは翌年度の計上額だと添える。
- **「子育て支援で自治体への支出が多い事業」**: 上の JSON のとおり `projectName`（正規表現）と `recipientName`（正規表現）を組み合わせる。
- **「この事業は再委託されているか」**: `get_subcontract_chain`。深さ 2 以上なら再々委託。
- **「支出先が偏っている事業」「『その他』が多い事業」**: `get_highlights` の `concentration` / `otherRatio`。
- **契約方式（1 者応札・随意契約）や落札率**: このツール群にはまだ無い。サイトの事業詳細（評価一覧のダイアログ）と委託構造ページに支出先ごとの契約方式・応札者数があるので、その URL を案内する。

## 答え方の注意

- 事業名は正式名で引用し、事業 ID（pid）を添える（同名の事業が複数の府省にある）。
- 執行額が予算より小さいことは珍しくない（繰越・不用）。乖離の理由を決めつけない。
- AI 評価の点数だけで良し悪しを断定しない。「公開資料に基づく試行の評価では」と前置きする。
- データに無いもの（地方自治体の予算、個別の契約書の中身、2023 年度以前の支出先）は無いと言う。自治体の配分は姉妹サイトの対象で、このサーバーでは引けない。
