# チームみらい ロゴアセット

LP (ランディングページ) やプロダクトの hero / ヘッダー / フッターで使う、チームみらいの公式ロゴ。
*再描画 (トレース) せず、必ずこのディレクトリのファイルをそのまま使う*。色やプロポーションを変えない。

新しく LP を作るとき・hero を組むときは、まずここから 1 つ選んでプロジェクトの `public/` にコピーして配置する。

## ファイル一覧

| ファイル | 中身 | サイズ | 使いどころ |
|---|---|---|---|
| [`team-mirai-wordmark.svg`](team-mirai-wordmark.svg) | 「Team Mirai」横組みワードマーク (黒・ベクター) | 263×39 (可変) | *LP / Web の第一候補*。ベクターなので拡大しても劣化しない。白背景・淡色背景のヘッダーやフッターに |
| [`team-mirai-logo.png`](team-mirai-logo.png) | 「チームみらい」カードロゴ＋ティールの影 (フルカラー) | 400×340 | hero の中央配置など、ブランドを前面に出す主役ロゴ。公式サイトのヘッダーで使われている版 |
| [`team-mirai-logo-flat.png`](team-mirai-logo-flat.png) | 「チームみらい」カードロゴ (影なし・フラット) | 240×201 | 影を付けたくないヘッダー / フッター / 小さめの配置に |

## どれを使うか

- *LP の hero でブランドを大きく見せたい* → `team-mirai-logo.png` (影付きカードロゴ)
- *ヘッダー / フッターにロゴを置く* → `team-mirai-wordmark.svg` (ベクターワードマーク) か `team-mirai-logo-flat.png`
- *とにかく劣化させたくない・サイズ可変* → `team-mirai-wordmark.svg`

迷ったら `team-mirai-wordmark.svg` を使う。

## 使い方

Next.js + `next/image` (プロジェクトの `public/` に置いた場合):

```tsx
import Image from "next/image";

<Image
  src="/logos/team-mirai-logo.png"
  alt="チームみらい"
  width={200}
  height={170}
  priority   // hero など above-the-fold のときだけ
/>
```

artifact API などの素の HTML (画像をインラインで持てないので絶対 URL を使う):

```html
<img
  src="https://raw.githubusercontent.com/team-mirai/internal_handbook_proto/main/docs/handbook/04-development/design-system/assets/logos/team-mirai-wordmark.svg"
  alt="チームみらい" width="200" />
```

## ライティング規約 (再掲)

- 本文の党名表記は「チームみらい」(ひらがな)。「チーム未来」「Team Mirai」は本文に書かない
- *ロゴ画像の中の「Team Mirai」表記はそのまま使ってよい* (ロゴはブランドアセットなので改変しない)

## 出典 (取得元)

各ファイルは下記の team-mirai 系リポジトリから取得した公式アセット (取得時点のコミットを permalink で固定)。

- `team-mirai-wordmark.svg` ← みらい議会: [`web/public/icons/team-mirai-typography.svg`](https://github.com/team-mirai/mirai-gikai/blob/9a37cac46180f964ce367d8a976ea7350254c560/web/public/icons/team-mirai-typography.svg)
- `team-mirai-logo.png` ← 公式サイト: [`src/assets/logo_main.png`](https://github.com/team-mirai/website/blob/be5507072c5e03c83d82070c1d26f2e5c1ac7c83/src/assets/logo_main.png) (公式サイトのヘッダーロゴ。アクションボードの `logo_shiro.png` と同一)
- `team-mirai-logo-flat.png` ← アクションボード: [`public/img/logo.png`](https://github.com/team-mirai-volunteer/action-board/blob/06ca7a683f7a7801aa3ff444e7c4c6d7733042fa/public/img/logo.png)
