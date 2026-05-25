---
description: Sankey図関連の実装を行う
---

## 対象

`/sankey-svg`（SVGベース直接支出 Sankey、公開メインページ）。

```text
app/sankey-svg/page.tsx              - SVG Sankey UI・ドリルダウン・サイドパネル・状態管理
app/lib/sankey-svg-filter.ts         - フィルタロジック（府省庁・事業・支出先・金額）
app/lib/sankey-svg-constants.ts      - レイアウト定数・ノード幅・列間隔
app/lib/sankey-svg-ids.ts            - ノードID正規化
app/lib/sankey-svg-year-selection.ts - 年度切り替え状態管理
client/components/SankeySvg/         - SVGコンポーネント群（MinimapOverlay 等）
```

## タスク

1. 上記から関連ファイルを読み込み、システムの全体像を把握する
2. ユーザーの指示に従って実装を行う

## レイヤー設計のルール

| 変更箇所 | 許可される内容 | 禁止される内容 |
|---------|--------------|--------------|
| `app/lib/sankey-svg-filter.ts` | Pure TypeScript、フィルタロジック | HTTPリクエスト、Reactコード |
| `app/lib/sankey-svg-constants.ts` | 定数定義のみ | ロジック・副作用 |
| `app/sankey-svg/page.tsx` | 状態管理、データ取得、レンダリング | 複雑なデータ変換ロジック |
| `client/components/SankeySvg/` | UIパーツ | 直接のAPIコール |

## 重要な仕様（必ず守ること）

- **金額単位**: データ内の金額はすべて **1円単位**（千円単位ではない）
  - 総予算 = 151兆円 = 151,120,000,000,000 円
- **「その他」と「その他の支出先」は別ノード**:
  - `その他`: 支出先名が「その他」のもの（~26兆円）
  - `その他の支出先`: TopN以外の集計（~51兆円）

## 関連ドキュメント

- アーキテクチャ全体: [CLAUDE.md](CLAUDE.md)
- 型定義: [types/sankey-svg.ts](types/sankey-svg.ts)、[types/structured.ts](types/structured.ts)
