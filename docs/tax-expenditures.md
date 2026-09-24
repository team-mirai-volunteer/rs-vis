# 租税特別措置ビュー

`/tax-expenditures` を主要ナビの「委託構造」の右に追加。

## データの範囲と再生成

財務省「租税特別措置の適用実態調査の結果に関する報告書（令和8年2月国会提出）」の確定版「総括表」シートを収録。

- [報告書](https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/index.html)
- [原表Excel](https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/houkoku01.xlsx)
- [概要・金額の定義](https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/gaiyou.pdf)

実績は2024年度、比較列は2022・2023年度。URLの `fy2025` や公表年2026と実績年を混同しない。所得税・地方税を含む租税支出全体は未収録。79の条文・制度区分は報告書全体の76項目とは異なる数え方で、過年度のみの区分も残す。

Pythonとopenpyxlが必要。リポジトリのルートで `python scripts/generate-tax-expenditures.py --download` を実行。取得元は `data/tax-expenditures/`、生成物は `app/lib/tax-expenditures/data.json`。生成物に原本SHA256・原表行番号を保持。原本に同梱されたドラフトシートは使わない。

原本「備考」の説明はセルではなくDrawing XMLにある。上段は単体法人、中段は**単体法人のうち通算法人（内数）**、2022年度の下段は連結法人。中段を足すと二重計上になる。2024年度の上段の件数合計2,513,286件を公式概要と照合する。過去年度の比較列には当時の全制度が載るわけではなく、歴史的な報告書全体の合計と一致しない。

金額は原表の千円のまま保持。適用額は税額控除、対象所得、特別償却限度額、準備金等で意味が違うので総額・削減可能額を計算しない。空欄と横棒はnull、数値0と区別。法人数の区分横断合計も重複を含むため掲載しない。期限は2025年4月1日時点、制度説明は原則2025年3月31日時点（改正追記あり）。

## RSとの接続

原表にRS事業IDはない。初期登録は1件：租特法42条の12の2の企業版ふるさと納税（法人税部分）と2025年度RSシートのID127「地方創生応援税制(企業版ふるさと納税)普及促進事業」。収録RSの事業目的が制度の広報・活用促進を明記し、事業URLも[公式制度案内](https://www.chisou.go.jp/tiiki/tiikisaisei/kigyou_furusato.html)を指す。

関係の種類は「制度の普及・運営」。税優遇額＝事業費、受益法人＝支出先という接続ではない。支出削減レポートへの金額加算はしない。他の制度は「未確認」で、関連事業の不存在を意味しない。政策分野の類似だけによる推測リンクは初期版では登録しない。追加時は根拠資料、年度、事業ID、関係の種類を検証する。

## GTETI

[公式ランキング](https://gteti.taxexpenditures.org/ranking/) v2.1（2026年5月11日更新）で日本は88位/116、37.1点。公開性4.0、制度的枠組み12.0、方法論・対象範囲4.3、制度説明データ11.2、評価5.6（各20点）。評価対象は2024年末までに公表された報告書で、この画面が使う2026年公表報告書への評価ではない。

GTETIは租税支出の報告を対象とする。低得点から個別制度の無駄や不正、廃止時の増収額は推論しない。「租税支出」と日本の「租税特別措置法」の範囲も同一視しない。

## 検証

- `python scripts/generate-tax-expenditures.py`：公式適用件数との照合
- `node node_modules/tsx/dist/cli.mjs --test tests/tax-expenditures.test.ts`
- `node node_modules/typescript/bin/tsc --noEmit`
- 開発サーバーを起動して `node tests/tax-expenditures-browser.mjs`：検索、年度切替、空結果、RS詳細リンク、モバイルの横幅
- `node node_modules/tsx/dist/cli.mjs scripts/generate-social-images.ts /tax-expenditures`：当ページのみOG画像生成
