# 品質スコアリング ガイド

スクリプト: `scripts/score-project-quality.py`

## 全体像

```mermaid
flowchart TB
    subgraph 入力データ
        CSV1["5-1 支出先_支出情報.csv"]
        CSV2["5-2 支出先_支出ブロックのつながり.csv"]
        CSV3["2-1 予算・執行_サマリ.csv"]
    end

    subgraph 辞書
        DICT["厳密辞書<br/>recipient_dictionary.csv<br/>(26,192件)"]
        GOV["行政機関辞書<br/>government_agency_names.csv<br/>(518件)"]
        SUPP["補助辞書<br/>supplementary_valid_names.csv<br/>(78件)"]
        OPAQUE["不透明キーワード辞書<br/>opaque_recipient_keywords.csv<br/>(13ルール)"]
    end

    subgraph スコア計算
        A1["軸1: 支出先名品質<br/>重み 40%"]
        A2["軸2: 法人番号記入率<br/>重み 20%"]
        A3["軸3: 予算・支出バランス<br/>重み 20%"]
        A4["軸4: ブロック構造<br/>重み 10%"]
        A5["軸5: 支出先名の透明性<br/>重み 10%"]
    end

    CSV1 --> A1 & A2 & A5
    CSV2 --> A4
    CSV3 --> A3
    DICT --> A1
    GOV --> A1
    SUPP --> A1
    OPAQUE --> A5
    CSV1 --> A3
    CSV2 --> A3

    A1 & A2 & A3 & A4 & A5 --> TOTAL["総合スコア<br/>(重み付き平均 0-100)"]

    TOTAL --> OUT_JSON["project-quality-scores-{YEAR}.json"]
    TOTAL --> OUT_CSV["project_quality_scores_{YEAR}.csv"]
```

---

## データロード フロー

```mermaid
flowchart LR
    subgraph "Phase 1: 辞書ロード"
        D1["厳密辞書ロード<br/>dict_map: name → bool<br/>public/data/dictionaries/recipient_dictionary.csv"]
        D2["行政機関辞書ロード<br/>gov_agency_map: name → agency_type<br/>public/data/dictionaries/government_agency_names.csv"]
        D3["補助辞書ロード<br/>supp_map: name → category<br/>public/data/dictionaries/supplementary_valid_names.csv"]
        D4["不透明辞書ロード<br/>opaque_rules: 13ルール<br/>public/data/dictionaries/opaque_recipient_keywords.csv"]
    end

    subgraph "Phase 2: 予算サマリ"
        B1["2-1 CSV<br/>予算年度=2023 & 会計区分=空"]
        B2["exec_by_pid<br/>budget_by_pid"]
        B1 --> B2
    end

    subgraph "Phase 3: ブロック接続"
        BL1["5-2 CSV読込"]
        BL2["BFS: 再委託深度算出"]
        BL3["ルートブロック特定"]
        BL4["孤立ブロック検出<br/>(5-1にあるが5-2にないブロック)"]
        BL1 --> BL2 & BL3 & BL4
    end

    subgraph "Phase 4: 支出先データ"
        SP1["5-1 CSV 1行ごと"]
        SP2["ProjectStats集計"]
        SP1 --> SP2
    end

    D1 & D2 & D3 & D4 --> SP2
    B2 --> SC
    BL2 & BL3 & BL4 --> SP2
    SP2 --> SC["Phase 5: スコア計算"]
```

---

## 軸1: 支出先名品質（重み40%）

```mermaid
flowchart TD
    NAME["支出先名"]
    NAME --> Q1{"厳密辞書に<br/>存在する?"}
    Q1 -- Yes --> Q2{"valid = True?"}
    Q1 -- No --> SKIP["カウント対象外<br/>(辞書未登録)"]
    Q2 -- Yes --> VALID["valid_count++"]
    Q2 -- No --> Q3{"行政機関辞書に<br/>存在する?"}
    Q3 -- Yes --> GOV["gov_agency_count++"]
    Q3 -- No --> Q4{"補助辞書に<br/>存在する?"}
    Q4 -- Yes --> SUPP["supp_valid_count++"]
    Q4 -- No --> INVALID["invalid_count++"]

    VALID & GOV & SUPP & INVALID --> CALC["axis1 = (valid + gov_agency + supp_valid)<br/>/ (valid + gov_agency + supp_valid + invalid)<br/>× 100"]

    style VALID fill:#4ade80
    style GOV fill:#86efac
    style SUPP fill:#60a5fa
    style INVALID fill:#f87171
    style SKIP fill:#9ca3af
```

### 辞書の階層構造

```mermaid
flowchart LR
    subgraph "厳密辞書 (recipient_dictionary.csv)"
        direction TB
        STRICT_V["valid=True: 18,233件<br/>法人番号DBと名称一致<br/>or 都道府県prefix市区町村"]
        STRICT_I["valid=False: 7,959件<br/>名称不一致 or 法人番号なし"]
    end

    subgraph "行政機関辞書 (government_agency_names.csv)"
        direction TB
        GOV_FO["field_office: 352件<br/>地方整備局・農政局・労働局・法務局 等"]
        GOV_PB["prefectural_branch: 87件<br/>都道府県警察・都道府県教育委員会 等"]
        GOV_MC["municipal_committee: 72件<br/>市区町村教育委員会・農業委員会 等"]
        GOV_SP["special_org: 7件<br/>特殊法人・学校法人地方機関 等"]
    end

    subgraph "補助辞書 (supplementary_valid_names.csv)"
        direction TB
        SUPP_UNI["university_rename: 78件<br/>改組前大学名<br/>(東京工業大学→東京科学大学 等)"]
    end

    STRICT_I -.->|"行政機関として確認済みを救済"| GOV_FO & GOV_PB & GOV_MC & GOV_SP
    STRICT_I -.->|"大学名改組等を救済"| SUPP_UNI
```

---

## 軸2: 法人番号記入率（重み20%）

```mermaid
flowchart TD
    ROW["支出先行（支出先名あり）"]
    ROW --> Q{"法人番号<br/>記入あり?"}
    Q -- Yes --> FILLED["cn_filled++"]
    Q -- No --> EMPTY["cn_empty++"]
    FILLED & EMPTY --> CALC["axis2 = cn_filled<br/>/ (cn_filled + cn_empty)<br/>× 100"]

    style FILLED fill:#4ade80
    style EMPTY fill:#f87171
```

---

## 軸3: 予算・支出バランス（重み20%）

```mermaid
flowchart TD
    subgraph 入力
        EXEC["執行額<br/>(2-1 CSV 予算年度2023)"]
        SPEND["実質支出額<br/>(5-1 CSV ルートブロックのみ合算)"]
    end

    EXEC & SPEND --> GAP["gap = |執行額 - 実質支出額|<br/>/ 執行額"]
    GAP --> CALC["axis3 = (1 - gap) × 100<br/>clamp(0, 100)"]

    subgraph "実質支出額の算出"
        direction TB
        ALL["支出先の合計支出額"]
        ROOT{"ルートブロック?<br/>(担当組織からの<br/>支出=TRUE)"}
        ALL --> ROOT
        ROOT -- Yes --> ADD["spend_net_total に加算"]
        ROOT -- No --> SKIP["除外<br/>(再委託先 = 二重計上)"]
    end

    style ADD fill:#4ade80
    style SKIP fill:#9ca3af
```

### gap の解釈

| gap | axis3 | 意味 |
|-----|-------|------|
| 0.0 | 100点 | 執行額と実質支出額が完全一致 |
| 0.1 | 90点 | 10%の乖離 |
| 0.5 | 50点 | 50%の乖離 |
| 1.0+ | 0点 | 執行額以上の乖離 |

---

## 軸4: ブロック構造の妥当性（重み10%）

```mermaid
flowchart TD
    BASE["基礎点: 100"]

    BASE --> CHK1{"再委託あり?"}
    CHK1 -- No --> CHK2
    CHK1 -- Yes --> DEDUCT1["減点: min(深度 × 10, 40)"]
    DEDUCT1 --> CHK2

    CHK2{"ブロック内<br/>金額不整合?<br/>(|ブロック合計 - 支出先合計|<br/>/ ブロック合計 > 20%)"}
    CHK2 -- No --> RESULT
    CHK2 -- Yes --> DEDUCT2["減点: min(不整合ブロック数 × 10, 30)"]
    DEDUCT2 --> RESULT["axis4 = clamp(基礎点 - 減点合計)"]
```

### 再委託深度の算出

```mermaid
flowchart LR
    subgraph "5-2 ブロック接続グラフ (BFS)"
        ORG["担当組織"] -->|"担当組織からの支出=TRUE"| A["ブロックA<br/>(深度0 = ルート)"]
        A --> C["ブロックC<br/>(深度1)"]
        C --> E["ブロックE<br/>(深度2)"]
        ORG --> B["ブロックB<br/>(深度0 = ルート)"]
    end

    E --> DEPTH["再委託深度 = 2"]
```

### 減点テーブル

| 再委託深度 | 減点 |
|-----------|------|
| 0 (なし) | 0 |
| 1 | -10 |
| 2 | -20 |
| 3 | -30 |
| 4+ | -40 |

| 金額不整合ブロック数 | 減点 |
|-------------------|------|
| 0 | 0 |
| 1 | -10 |
| 2 | -20 |
| 3+ | -30 |

---

## 軸5: 支出先名の透明性（重み10%）

```mermaid
flowchart TD
    NAME["支出先名"]
    NAME --> RULES{"不透明キーワード辞書<br/>にマッチ?"}

    subgraph "マッチ方式 (上から順に評価)"
        R1["exact: 完全一致"]
        R2["prefix: 前方一致 (自身を除く)"]
        R3["contains: 部分一致 (自身を除く)"]
        R4["regex: 正規表現"]
    end

    RULES -- マッチ --> OPAQUE["opaque_count++"]
    RULES -- 不一致 --> PASS["カウントせず"]

    OPAQUE & PASS --> RATIO["opaque_ratio = opaque_count / row_count"]
    RATIO --> CALC["axis5 = (1 - opaque_ratio / 0.5) × 100<br/>clamp(0, 100)"]

    style OPAQUE fill:#f87171
    style PASS fill:#4ade80
```

### 不透明キーワード辞書 (13ルール)

| パターン | 方式 | レベル | 説明 |
|---------|------|--------|------|
| `その他` | exact | 1 | 完全不明 |
| `その他の支出先` | exact | 1 | 完全不明 |
| `その他支出先` | exact | 1 | 完全不明 |
| `未定` | exact | 1 | 未確定 |
| `非公開` | exact | 1 | 非公開 |
| `個人` | exact | 2 | 匿名化 |
| `^[A-Za-z]社$` | regex | 2 | A社, B社 等 |
| `^○○` | regex | 3 | プレースホルダー |
| `^××` | regex | 3 | プレースホルダー |
| `^■■` | regex | 3 | プレースホルダー |
| `その他` | prefix | 2 | 「その他○○」集約表記 |
| `未定` | contains | 2 | 未確定を含む |
| `非公開` | contains | 2 | 非公開を含む |

### opaque_ratio の解釈

| opaque_ratio | axis5 | 意味 |
|-------------|-------|------|
| 0% | 100点 | 不透明な支出先名なし |
| 10% | 80点 | 10%が不透明 |
| 25% | 50点 | 25%が不透明 |
| 50%+ | 0点 | 半数以上が不透明 |

---

## 総合スコア

```mermaid
flowchart LR
    A1["軸1<br/>×40"] --> SUM
    A2["軸2<br/>×20"] --> SUM
    A3["軸3<br/>×20"] --> SUM
    A4["軸4<br/>×10"] --> SUM
    A5["軸5<br/>×10"] --> SUM

    SUM["加重合計 / 有効重み合計"] --> TOTAL["総合スコア<br/>(0-100, 小数第1位)"]
```

$$
\text{totalScore} = \frac{\sum_{i \in \text{有効軸}} \text{axis}_i \times w_i}{\sum_{i \in \text{有効軸}} w_i}
$$

軸スコアが `None`（データなし）の場合、その軸は除外され残りの重みで再配分される。

### 重み配分の根拠

| 軸 | 重み | 根拠 |
|----|------|------|
| 軸1 支出先名品質 | 40% | 支出先が特定できるかが最も重要な品質指標 |
| 軸2 法人番号記入率 | 20% | 法人番号による追跡可能性 |
| 軸3 予算・支出バランス | 20% | 予算執行の説明責任 |
| 軸4 ブロック構造 | 10% | 再委託の複雑さ（構造的リスク） |
| 軸5 透明性 | 10% | 不透明名称の使用（軸1と補完関係） |

---

## 出力ファイル

```mermaid
flowchart LR
    CALC["スコア計算結果"]
    CALC --> CSV["data/result/<br/>project_quality_scores_{YEAR}.csv<br/>(分析用)"]
    CALC --> JSON["public/data/<br/>project-quality-scores-{YEAR}.json<br/>(UI表示用)"]
    CALC --> RJSON["public/data/<br/>project-quality-recipients-{YEAR}.json<br/>(支出先詳細用)"]
    JSON --> API["app/api/quality-scores/<br/>route.ts"]
    RJSON --> API2["app/api/quality-scores/recipients/<br/>route.ts"]
    API --> UI["app/quality/page.tsx"]
```
