---
description: Sankey図関連の実装を行う
---

## タスク

1. 以下のファイルを読み込み、Sankey図システムの全体像を把握する：
   - [app/lib/sankey-generator.ts](app/lib/sankey-generator.ts) - Sankey生成アルゴリズム（核心ロジック）
   - [app/sankey/page.tsx](app/sankey/page.tsx) - メインUI・状態管理
   - [app/api/sankey/route.ts](app/api/sankey/route.ts) - APIエンドポイント

2. ユーザーの指示に従って実装を行う。

## レイヤー設計のルール

| 変更箇所 | 許可される内容 | 禁止される内容 |
|---------|--------------|--------------|
| `app/lib/sankey-generator.ts` | Pure TypeScript、データ変換ロジック | HTTPリクエスト、Reactコード |
| `app/api/sankey/route.ts` | リクエスト処理、`sankey-generator.ts` の呼び出し | ビジネスロジックの直書き |
| `app/sankey/page.tsx` | 状態管理、API呼び出し、レンダリング | 複雑なデータ変換ロジック |
| `client/components/` | UIパーツ | 直接のAPIコール |

## 重要な仕様（必ず守ること）

- **金額単位**: データ内の金額はすべて **1円単位**（千円単位ではない）
  - 総予算 = 146兆円 = 146,000,000,000,000 円
- **「その他」と「その他の支出先」は別ノード**:
  - `その他`: 支出先名が「その他」のもの（~26兆円）
  - `その他の支出先`: TopN以外の集計（~51兆円）
- **5列Sankey**: 総予算 → 府省庁 → 事業(予算) → 事業(支出) → 支出先

## 関連ドキュメント

- アーキテクチャ全体: [CLAUDE.md](CLAUDE.md)
- 型定義: [types/structured.ts](types/structured.ts)、[types/preset.ts](types/preset.ts)
