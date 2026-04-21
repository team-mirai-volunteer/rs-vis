#!/usr/bin/env python3
"""
府省庁・局・部・課・室・班・係の一覧 CSV を生成する。

ソース:
  1. data/result/recipients.db   (2024年度支出実績から自動抽出)
  2. SUPPLEMENT リスト           (実績データに現れない主要機関を手動補完)
     参照: 内閣官房 行政機関一覧（人事局 組織・定員管理）
     https://www.cas.go.jp/jp/gaiyou/jimu/jinjikyoku/satei_01_03_01.html

出力: data/result/ministry_names.csv
列: policy_ministry, ministry, bureau, division, section, office, team, unit, source
  source: "data" | "supplement"
"""

import csv
import os
import sqlite3

DB_PATH  = os.path.join(os.path.dirname(__file__), '..', 'data', 'result', 'recipients.db')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'dictionaries', 'ministry_names.csv')

FIELDS = ["policy_ministry", "ministry", "bureau", "division",
          "section", "office", "team", "unit", "source"]

# ─────────────────────────────────────────
# 補完データ: 実績データに現れない主要機関
# (policy_ministry, ministry, bureau, division, section, office, team, unit)
# 下位階層が不明な場合は上位まで入れて空欄
# ─────────────────────────────────────────
SUPPLEMENT = [
    # 会計検査院（独立機関）
    ("会計検査院", "会計検査院", "", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "事務総長官房", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "第一局", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "第二局", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "第三局", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "第四局", "", "", "", "", ""),
    ("会計検査院", "会計検査院", "第五局", "", "", "", "", ""),

    # 人事院（独立機関）
    ("人事院", "人事院", "", "", "", "", "", ""),
    ("人事院", "人事院", "事務総長官房", "", "", "", "", ""),
    ("人事院", "人事院", "給与局", "", "", "", "", ""),
    ("人事院", "人事院", "職員福祉局", "", "", "", "", ""),
    ("人事院", "人事院", "公平審査局", "", "", "", "", ""),
    ("人事院", "人事院", "管理局", "", "", "", "", ""),

    # 内閣府 ── 宮内庁（外局）
    ("内閣府", "宮内庁", "", "", "", "", "", ""),
    ("内閣府", "宮内庁", "長官官房", "", "", "", "", ""),
    ("内閣府", "宮内庁", "侍従職", "", "", "", "", ""),
    ("内閣府", "宮内庁", "東宮職", "", "", "", "", ""),
    ("内閣府", "宮内庁", "式部職", "", "", "", "", ""),
    ("内閣府", "宮内庁", "書陵部", "", "", "", "", ""),
    ("内閣府", "宮内庁", "管理部", "", "", "", "", ""),

    # 内閣府 ── 国家公安委員会
    ("内閣府", "国家公安委員会", "", "", "", "", "", ""),

    # 経済産業省 ── 資源エネルギー庁
    ("経済産業省", "資源エネルギー庁", "", "", "", "", "", ""),
    ("経済産業省", "資源エネルギー庁", "長官官房", "", "", "", "", ""),
    ("経済産業省", "資源エネルギー庁", "資源・燃料部", "", "", "", "", ""),
    ("経済産業省", "資源エネルギー庁", "電力・ガス事業部", "", "", "", "", ""),
    ("経済産業省", "資源エネルギー庁", "省エネルギー・新エネルギー部", "", "", "", "", ""),
    ("経済産業省", "資源エネルギー庁", "電力基盤整備課", "", "", "", "", ""),

    # 経済産業省 ── 中小企業庁
    ("経済産業省", "中小企業庁", "", "", "", "", "", ""),
    ("経済産業省", "中小企業庁", "長官官房", "", "", "", "", ""),
    ("経済産業省", "中小企業庁", "事業環境部", "", "", "", "", ""),
    ("経済産業省", "中小企業庁", "経営支援部", "", "", "", "", ""),
    ("経済産業省", "中小企業庁", "技術・経営革新課", "", "", "", "", ""),

    # 国土交通省 ── 国土地理院
    ("国土交通省", "国土交通省国土地理院", "", "", "", "", "", ""),
    ("国土交通省", "国土交通省国土地理院", "総務部", "", "", "", "", ""),
    ("国土交通省", "国土交通省国土地理院", "測地部", "", "", "", "", ""),
    ("国土交通省", "国土交通省国土地理院", "地理地殻活動研究センター", "", "", "", "", ""),

    # 法務省 ── 公安審査委員会
    ("法務省", "公安審査委員会", "", "", "", "", "", ""),

    # 農林水産省 ── 農林水産技術会議
    ("農林水産省", "農林水産技術会議", "", "", "", "", "", ""),

    # 環境省 ── 原子力規制委員会（別途単独でも存在するが環境省外局として）
    # ※ 現データでは単独エントリとして存在するため省略

    # 財務省 ── 造幣局・国立印刷局（独立行政法人だが参考として）
    # ※ 独立行政法人は別カテゴリとして扱うため省略
]


def row_from_db(rec) -> dict:
    keys = ["policy_ministry", "ministry", "bureau", "division",
            "section", "office", "team", "unit"]
    return {k: (v or "") for k, v in zip(keys, rec)} | {"source": "data"}


def row_from_supplement(t: tuple) -> dict:
    keys = ["policy_ministry", "ministry", "bureau", "division",
            "section", "office", "team", "unit"]
    return {k: v for k, v in zip(keys, t)} | {"source": "supplement"}


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("""
        SELECT DISTINCT
            policy_ministry, ministry, bureau, division,
            section, office, team, unit
        FROM recipients
        ORDER BY policy_ministry, ministry, bureau, division,
                 section, office, team, unit
    """)
    db_rows = [row_from_db(r) for r in cur.fetchall()]
    con.close()

    supp_rows = [row_from_supplement(t) for t in SUPPLEMENT]

    # 補完データのうち DB に既存のものは除外
    db_keys = {
        (r["policy_ministry"], r["ministry"], r["bureau"],
         r["division"], r["section"], r["office"], r["team"], r["unit"])
        for r in db_rows
    }
    supp_rows = [r for r in supp_rows
                 if (r["policy_ministry"], r["ministry"], r["bureau"],
                     r["division"], r["section"], r["office"],
                     r["team"], r["unit"]) not in db_keys]

    all_rows = db_rows + supp_rows

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(all_rows)

    # サマリー
    data_cnt   = sum(1 for r in all_rows if r["source"] == "data")
    supp_cnt   = sum(1 for r in all_rows if r["source"] == "supplement")
    ministries = {r["ministry"] for r in all_rows if r["ministry"]}
    bureaus    = {(r["ministry"], r["bureau"]) for r in all_rows if r["bureau"]}
    sections   = {(r["ministry"], r["bureau"], r["section"]) for r in all_rows if r["section"]}

    print(f"生成完了 → {OUT_PATH}")
    print(f"  総行数: {len(all_rows):,}  (data:{data_cnt:,} + supplement:{supp_cnt})")
    print(f"  府省庁: {len(ministries)}件")
    print(f"  局・庁 (ユニーク): {len(bureaus)}件")
    print(f"  課 (ユニーク): {len(sections)}件")

    print("\n--- 補完機関一覧 ---")
    supp_ministries = sorted({r["ministry"] for r in supp_rows if r["ministry"]})
    for m in supp_ministries:
        print(f"  {m}")


if __name__ == "__main__":
    main()
