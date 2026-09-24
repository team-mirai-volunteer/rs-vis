"""ストレッチ版の試算。外部予算額は出典を確認して固定、率は政策提案。"""
import contextlib
import io
import json
import runpy
from decimal import Decimal
from pathlib import Path

HERE = Path(__file__).resolve().parent
with contextlib.redirect_stdout(io.StringIO()):
    prior = runpy.run_path(str(HERE / "calculate.py"))

# 同じ範囲の制度を次回も同規模で継続する仮想ベースライン。
# 2027年度要求額・未契約残額ではなく、公表済みの直近制度の予算規模。
actions = [
    dict(id="S01", name="長期優良・ZEH水準の新築住宅補助を絞る", pid="7763",
         base=145_000_000_000, rates=[10, 30, 40],
         basis="みらいエコ住宅2026・長期優良住宅／ZEH水準住宅分。旧PIDの同一事業・同一対象ではなく関連する現行制度。",
         source="https://mirai-eco2026.mlit.go.jp/about/"),
    dict(id="S02", name="訪日プロモーションの出稿・出展規模を縮減", pid="7767（探索入口のみ）",
         base=13_627_000_000, rates=[15, 30, 40],
         basis="令和8年度当初予算・戦略的な訪日プロモーションの実施。PDF物理11ページ／冊子8ページ。旧PIDの直接後継とは認定していない。",
         source="https://www.mlit.go.jp/page/content/001982280.pdf"),
    dict(id="S03", name="観光コンテンツ補助の定額枠・採択枠を縮小", pid="7767（関連分野）",
         base=4_900_000_000, rates=[20, 40, 60],
         basis="令和7年度補正・観光需要分散のための地域観光資源のコンテンツ化促進事業。PDF物理59ページ／冊子56ページ。",
         source="https://www.mlit.go.jp/page/content/001982280.pdf"),
    dict(id="S04", name="高付加価値観光地の伴走・招請事業を縮小", pid="7767（関連分野）",
         base=1_200_000_000, rates=[15, 30, 50],
         basis="令和7年度補正・地方における高付加価値なインバウンド観光地づくり。PDF物理61ページ／冊子58ページ。",
         source="https://www.mlit.go.jp/page/content/001982280.pdf"),
]

def calc(base, rate):
    gross = base * rate // 100
    reserve = gross * 20 // 100
    return gross, reserve, gross - reserve

def oku(n):
    return f"{Decimal(n) / Decimal(100_000_000):,.8f}".rstrip("0").rstrip(".")

prior_net = prior["totals"][1]
prior_gross = prior["gross_total"]
totals = [prior_net] * 3
gross_total = prior_gross
reserve_total = prior_gross - prior_net
body = ["# ストレッチ版・計算台帳", "",
    "金額は円。2027年度以降の次回制度・契約更新で同規模継続する場合の政策シナリオ。既決定の2026年度予算の即時削減額ではない。",
    "前回A01〜A14は標準案を一度だけ引き継ぐ。S01〜S04は別の予算枠で、旧PIDの2024年度執行額を加えない。",
    "粗削減の20%を重点支援・移行・効果検証の費用として再投入すると仮定。受益者の便益損失を貨幣換算した控除ではない。", "",
    "|ID|対象|基準額|標準率|粗削減|再投入留保|差引|累計|",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    f"|A01〜A14|前回の調達改善|{prior['base_total']:,}|各案別|{prior_gross:,}|{reserve_total:,}|{prior_net:,}|{prior_net:,}|"]
seen = set()
for a in actions:
    key = a["name"]
    assert key not in seen
    seen.add(key)
    for i, rate in enumerate(a["rates"]):
        assert 0 <= rate <= 100
        totals[i] += calc(a["base"], rate)[2]
    gross, reserve, net = calc(a["base"], a["rates"][1])
    gross_total += gross
    reserve_total += reserve
    body.append(f"|{a['id']}|{a['name']}|{a['base']:,}|{a['rates'][1]}%|{gross:,}|{reserve:,}|{net:,}|{totals[1]:,}|")
assert gross_total - reserve_total == totals[1]
body.extend([f"|合計||||{gross_total:,}|{reserve_total:,}|{totals[1]:,}||", "",
    "## 率の感度", "", "前回の調達改善額を固定し、新規4案の率だけを変える。確率区間ではない。", "",
    "|案|低位|ストレッチ標準|上位|", "|---|---:|---:|---:|"])
for a in actions:
    body.append(f"|{a['id']}|{a['rates'][0]}%|{a['rates'][1]}%|{a['rates'][2]}%|")
body.append("|差引合計（円）|" + "|".join(f"{n:,}" for n in totals) + "|")
body.append("|差引合計（億円）|" + "|".join(oku(n) for n in totals) + "|")
body.extend(["", "## 前提が崩れた場合", "",
    f"- 標準案の半分だけ次回に実施可能：{totals[1] // 2:,}円（{oku(totals[1] // 2)}億円）。費用も比例する簡易感度。",
    f"- 住宅S01を全て不採用：{totals[1] - calc(actions[0]['base'],30)[2]:,}円。",
    f"- 留保を全案で粗削減の40%に増額：概ね{oku(gross_total * 60 // 100)}億円。",
    f"- 170億円との名目比：{totals[1] / 17_000_000_000:.4f}倍。対象・年度・実現度が異なるため成果比較ではない。", "",
    "## 外部基準額の出典（2026-09-24確認）", ""])
for a in actions:
    body.extend([f"### {a['id']} {a['name']}", "", f"- 基準：{a['basis']}",
        f"- 公表額：{a['base']:,}円。", f"- 出典：[公式資料]({a['source']})",
        f"- アプリの探索入口：PID {a['pid']}。金額はこのPIDから転載していない。", ""])
fund_base = prior["scores"]["3649"]["execAmount"]
fund_gross, fund_reserve, fund_net = calc(fund_base, 10)
body.extend(["## 基金の追加造成を絞る別枠（上記合計に含めない）", "",
    f"PID3649の2024年度交付額{fund_base:,}円を規模の参考に、次回造成を10%減らす場合：粗額{fund_gross:,}円、留保{fund_reserve:,}円、差引{fund_net:,}円。",
    "基金の確定残高、交付決定済額、将来需要が不明なので採用保留。多年度の国費入金抑制であり、毎年の節約でも既存基金の返納額でもない。", "",
    "再計算：`python docs/ai-review/calculate-stretch.py`。外部基準額は手動転記した固定値のため、予算資料が改訂された場合は更新が必要。"])
(HERE / "stretch-ledger.md").write_text("\n".join(body) + "\n", encoding="utf-8")
print(json.dumps(dict(totals=totals, gross=gross_total, reserve=reserve_total, fund_separate=fund_net),ensure_ascii=False))
