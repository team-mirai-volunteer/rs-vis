# PR #35「本番だけ Google Analytics 4 を読み込む」のレビュー

対象: https://github.com/team-mirai-volunteer/rs-vis/pull/35（1 コミット 3c2ddf0、+187 −14、10 ファイル。base は main）
作者: banbiossa（Cursor Agent）。レビュー日: 2026-10-19。

## 結論

実装は小さく筋が通っている（本番だけ・/admin 除外・CSP を最小限に広げる・テストあり）。
ただし **マージ前に直してほしい点が 2 つ**（2・3）と、**推奨が 1 つ**（1）ある。

1. **（推奨に格下げ）URL のクエリ・ハッシュが Google に送られる。** 国民負担ページは年収・世帯の型・年齢を URL に持ち、GA4 の拡張計測は履歴の変化ごとに `page_location`（クエリ・ハッシュ込み）を送る。ただし値は仮定の入力で本人の実収入とは限らず、氏名等とも結びつかないので、個人情報には当たらず法的な問題にはなりにくい（2026-10-19 に相談して格下げ）。残るのは「自分の年収を入れた人がそれを Google に送られると知らされていない」点だけ。最小の対処はポリシー第 5 項の「閲覧したページ」を「閲覧したページ（絞り込み条件などを含む URL）」と補うこと。パスだけ送る実装（`gtag('config', id, { page_location: origin + pathname })`。`@next/third-parties` は config の追加引数を受けないので自前の gtag が要る）は必要になってからでよい。
2. **Google の利用規約が求める開示が足りない。** GA の利用規約（7. Privacy）は、GA を使う旨と「Google によるデータの利用」（https://policies.google.com/technologies/partner-sites）へのリンクを掲示することを求める。改正電気通信事業法の外部送信規律でも、送信先での利用目的を示す必要がある。第 5 項に 1 文と Google のページへのリンクを足す。
3. **dev と衝突する。** dev（PR #38、マージ待ち）は弁護士レビューを反映して `app/privacy/page.tsx` と `app/lib/legal.ts` を変えており、この PR と `changed in both` になる。また当プロジェクトの流れは dev → main（直接 main へ入れると dev へ戻す手間が要る）。PR #38 を先に入れてから、この PR を dev に rebase するのが安全。

## 細かい指摘

- **既定の測定 ID（`G-R7STTQBRZJ`）をコードに埋める設計。** フォークを Vercel の production に置いた人の計測が本家のプロパティに混ざる。PR 本文も認めている。環境変数が無ければ計測しない（既定値なし）の方が事故が無い。Terraform（`infra/terraform`）で `NEXT_PUBLIC_GA_MEASUREMENT_ID` を配るのが本来の形。
- **プライバシーポリシーの更新日を規約と分けた**（`PRIVACY_UPDATED`）。妥当。ただし dev 側の弁護士レビュー版と文面を合わせる必要がある（上記 3）。
- **CSP** は Google の案内どおりで、`*.google.com` を開けていないのは良い。`script-src` の `https://www.googletagmanager.com` は gtag が追加で読む `googletagmanager.com` 配下のスクリプトもこのホストなので足りる。
- **マウント後に描画する実装**（`mounted` state）は、404 が静的 not-found を共有する事情への対処として妥当。`usePathname` は App Router なら not-found でも実パスを返すので意図どおり動く。
- **テスト**は純関数 3 つと、`next.config.ts` を正規表現で読む CSP テスト。後者は壊れやすいが、CSP の退行を止める目的には足りる。
- `.env.example` が新規。README には触れていない（PR 本文のチェックリストどおり）。

## 確認したこと

- `@next/third-parties@15.5.27` の `GoogleAnalytics` は `gtag('config', id)` だけで、ルート変化の送信は GA4 側の拡張計測に任せている（クエリ込みの `page_location` が送られる根拠）。
- 本番ビルド・ブラウザ確認は PR 本文の記載を信頼した（ローカルでは再現していない）。
