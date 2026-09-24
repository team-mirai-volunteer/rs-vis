"""ローカルのアプリデータから仕分け台帳を再計算。python docs/ai-review/calculate.py"""
import hashlib
import json
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
FILES = [f"public/data/{name}" for name in (
    "project-quality-scores-2025.json", "project-quality-recipients-2025.json",
    "rs2025-project-details.json")]
scores, recipients, details = [json.loads((ROOT / p).read_text(encoding="utf-8")) for p in FILES]
scores = {x["pid"]: x for x in scores}
# index は recipients[pid] の0始まり。根拠明細を台帳に全文保存する。
# 率はAIによる検討用の仮定であり、観測された削減可能率ではない。
ACTIONS = [
    ("A01", "5508", [1], 50, "屋外広告の掲載枠を半減", "掲出場所・期間ごとの到達と申請転換を照合し、低寄与枠から削る。代替は政府サイト・公共施設案内。", "高齢者等への到達低下を確認し、重要手続の告知到達率を維持できる枠だけ削減。"),
    ("A02", "5508", [8], 25, "新聞突出し広告の掲載回数を整理", "同一テーマの反復掲載を減らし、版下を再利用する。新聞を必要とする層への告知は残す。", "媒体別の認知増分・手続利用単価を比較し、対象者への到達が落ちないこと。"),
    ("A03", "5508", [13], 25, "新聞・雑誌・ニュースサイト広告を集約", "媒体別発注を共通素材・年間枠にまとめ、重複接触の多い掲載を削る。A02とは別明細。", "媒体費・制作費・手数料の内訳提出。A02との対象期間重複と契約同一性を照合。"),
    ("A04", "5508", [4, 11, 14], 15, "ネット広告とSNS運用の仕様を共通化", "計測タグ、LP、レポートを共通化し、広告枠と運用費を分離見積りする。低転換広告を停止。", "セキュリティ・アクセシビリティを維持し、重複ユーザー控除後の申請転換単価を測る。"),
    ("A05", "5508", [12], 20, "テレビ・ラジオCMの制作と放送を整理", "既存素材の再編集と放送頻度の見直し。災害・給付期限など到達が必要な告知は維持。", "制作費と媒体費を分け、放送回数削減が対象者の認知に与える影響を試行で確認。"),
    ("A06", "5508", [5, 15], 50, "広告PoCを統合し次回発注を半減", "対象層と新媒体の検証を一つの比較実験にまとめる。既存成果を再利用し探索範囲を絞る。", "成果物と仮説の重複を確認。既に完了し再発注予定がない場合は削減額0円。"),
    ("A07", "98", [0, 33], 20, "海外向け電子雑誌・広報誌の編集工程を共通化", "取材、原稿、写真、翻訳資産を共通管理し媒体ごとの再編集に限定する。", "異なる読者層に必要な編集・翻訳品質を維持。重複業務がなければ計上しない。"),
    ("A08", "98", [35], 20, "国際広報SNSの配信と制作を整理", "地域別効果の弱い配信枠を縮小し、多言語素材を再利用する。", "対象国での理解度変化と有効到達単価を測り、外交上不可欠な発信を確保。"),
    ("A09", "98", [36, 40], 20, "海外テレビ等の年間広告枠を共同調達", "番組・記事広告とテレビCMの媒体調達を一体で比較し、重複する到達を削る。", "二明細の契約番号・放送枠を突合し別支出と確認。解約不能な既契約は対象外。"),
    ("A10", "98", [37, 38], 15, "戦略メッセージと課題別広報を共通制作", "両広報の素材と効果測定を共通化し、似た対象への重複配信を減らす。", "目的・受け手の異なる部分は残す。PID1069への支出委任は本台帳に含めない。"),
    ("A11", "1069", [0, 1, 2], 5, "ジャパン・ハウス3拠点の共通運営調達", "巡回展の制作・輸送、調達、予約システム等を共同化する。拠点閉鎖は提案しない。", "家賃等の固定費と変動費を分離。実際に動かせる費目の節約で総額5%に届くか確認。来館満足度を維持。"),
    ("A12", "3985", [1, 2, 3, 4, 5, 6], 15, "国際会議・ICEFの運営発注を集約", "会場・配信・通訳・事務局の共通仕様化と開催日程調整。研究内容は削減対象から除く。", "運営と調査の混合契約は内訳を取得し、研究費を保護した上で目標額に届くこと。"),
    ("A13", "3985", [7, 8, 9], 20, "AZEC等の会合・対外発信を共通運営", "会合と発信の素材を共通化し、一部準備会をオンライン化する。", "政府間の合意形成を阻害しないこと。調査を含むため運営費の対象範囲を再確定。"),
    ("A14", "3985", [13, 16, 20], 15, "金融・カーボンリサイクル・LNG会議の運営を共通化", "会場手配、通訳、配信、参加登録を共通契約にし、成果物の重複制作を避ける。", "議題ごとの専門調査を維持。A12・A13と共有する節約は一度だけ計上。"),
]

def yen(x):
    return f"{x:,}"

seen = set()
totals = [0, 0, 0]
gross_total = base_total = 0
rows = []
body = ["# 推奨アクション台帳（自動集計）", "",
        "2025年度レビューシートに収録された2024年度支出。金額は円。各率は次回同規模発注を仮定した検討目標。実現額ではない。",
        "再委託を除き、直接支出明細だけを一度ずつ採用。標準の粗削減額に対して20%を代替対応・移行費の仮置きとして控除する。控えめは標準率の半分、強めは1.5倍。端数は各アクション・各段階で1円未満切捨て。", "",
        "|ID|PID|アクション|対象支出|標準率|粗削減|移行等留保|差引標準|標準累計|",
        "|---|---|---|---:|---:|---:|---:|---:|---:|"]
cards = []
for aid, pid, indices, pct, title, action, gate in ACTIONS:
    selected = [recipients[pid][i] for i in indices]
    for i, r in zip(indices, selected):
        assert (pid, i) not in seen, "明細の二重計上"
        seen.add((pid, i))
        assert r["r"] is True and r["d"] == 0 and r["a2"] > 0
    base = sum(r["a2"] for r in selected)
    gross = base * pct // 100
    reserve = gross * 20 // 100
    net = gross - reserve
    scenario = []
    for factor in [Decimal("0.5"), Decimal("1"), Decimal("1.5")]:
        g = int((Decimal(base) * Decimal(pct) / 100 * factor).to_integral_value(rounding=ROUND_FLOOR))
        scenario.append(g - g * 20 // 100)
    totals = [a + b for a, b in zip(totals, scenario)]
    base_total += base
    gross_total += gross
    body.append(f"|{aid}|{pid}|{title}|{yen(base)}|{pct}%|{yen(gross)}|{yen(reserve)}|{yen(net)}|{yen(totals[1])}|")
    cards.extend(["", f"## {aid} {title}", "",
        f"- 事業：{details[pid]['projectName']}（{details[pid]['ministry']}、PID {pid}）",
        f"- アプリ：[事業詳細](http://localhost:3000/quality?fiscalYear=2024&pid={pid}&detail={pid})",
        f"- 推奨：縮減・統合の条件付き査定案。{action}",
        f"- 実施前条件・保護する機能：{gate}",
        f"- 金額：{yen(base)} × {pct}% = 粗削減{yen(gross)}円、留保{yen(reserve)}円、差引{yen(net)}円。",
        f"- 感度：控えめ{yen(scenario[0])}円／標準{yen(scenario[1])}円／強め{yen(scenario[2])}円。",
        "- 証拠：以下の直接支出はアプリ収録値。業務の重複・削減率・次回予算への反映は未確認。",
        "", "|明細index|支出先|契約・使途|直接支出（円）|", "|---:|---|---|---:|"])
    for i, r in zip(indices, selected):
        cards.append(f"|{i}|{r['n']}|{r['cc'].replace('|', '／')}|{yen(r['a2'])}|")
    rows.append({"id": aid, "pid": pid, "base": base, "gross": gross, "reserve": reserve, "net": net})

body.extend([f"|合計|||{yen(base_total)}||{yen(gross_total)}|{yen(gross_total-totals[1])}|{yen(totals[1])}||", "",
    f"**差引合計：控えめ {yen(totals[0])}円／標準 {yen(totals[1])}円／強め {yen(totals[2])}円。確定削減額は0円（未実施）。**"])
body.extend(cards)
body.extend(["", "## 再計算と検証", "", "実行：`python docs/ai-review/calculate.py`", "",
    f"{len(ACTIONS)}アクション、{len(seen)}明細、{len(set(x[1] for x in ACTIONS))}事業。全明細が直接支出、同一明細の重複なし。",
    "事業別の対象支出は執行額以下であることを検証。ただし異なるPID間の同一契約の有無は契約番号の追加取得が必要。", "",
    "|PID|事業全体の執行額|対象明細合計|", "|---|---:|---:|"])
for pid in dict.fromkeys(x[1] for x in ACTIONS):
    amount = sum(x["base"] for x in rows if x["pid"] == pid)
    assert amount <= scores[pid]["execAmount"]
    body.append(f"|{pid}|{yen(scores[pid]['execAmount'])}|{yen(amount)}|")
body.extend(["", "### 入力ファイルのSHA-256", ""])
for p in FILES:
    body.append(f"- `{p}`：`{hashlib.sha256((ROOT / p).read_bytes()).hexdigest()}`")
(OUT / "action-ledger.md").write_text("\n".join(body) + "\n", encoding="utf-8")
print(json.dumps({"actions": len(ACTIONS), "items": len(seen), "base": base_total, "gross": gross_total,
    "reserve": gross_total - totals[1], "net_low_standard_high": totals}, ensure_ascii=False))
