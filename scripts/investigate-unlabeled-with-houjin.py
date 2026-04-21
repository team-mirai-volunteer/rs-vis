"""
ラベルなし・法人番号あり 支出先 調査スクリプト

入力: public/data/entity-labels-csv.json（generate-entity-labels-csv.py の出力）
出力: data/result/unlabeled_with_houjin.csv
      コンソール: typeCode 別サマリー

フィルタ条件:
  - source == 'none'（未ラベル）
  - cn != ''（法人番号あり）

実行:
  python3 scripts/investigate-unlabeled-with-houjin.py
"""

import csv
import json
import os
from collections import defaultdict

REPO_ROOT   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUT_JSON  = os.path.join(REPO_ROOT, 'public', 'data', 'entity-labels-csv.json')
OUTPUT_CSV  = os.path.join(REPO_ROOT, 'data', 'result', 'unlabeled_with_houjin.csv')

KTYPE_LABEL = {
    '101': '国の機関',
    '201': '地方公共団体',
    '301': '株式会社',
    '302': '有限会社',
    '303': '合名会社',
    '304': '合資会社',
    '305': '合同会社',
    '399': 'その他設立登記法人',
    '401': '外国会社等',
    '499': 'その他',
}
KTYPE_PRIORITY = ['201', '101', '399', '301', '302', '303', '304', '305', '401', '499']


def pick_primary_typecode(type_codes: list[str]) -> str:
    """優先順位に従って代表 typeCode を 1 つ返す。該当なしは ''"""
    for tc in KTYPE_PRIORITY:
        if tc in type_codes:
            return tc
    return type_codes[0] if type_codes else ''


def to_oku(yen: int) -> str:
    return f'{yen / 1e8:.2f}億円'


def to_cho(yen: int) -> str:
    return f'{yen / 1e12:.3f}兆円'


def main():
    if not os.path.exists(INPUT_JSON):
        print(f'エラー: {INPUT_JSON} が見つかりません。')
        print('先に npm run generate-entity-labels-csv を実行してください。')
        return

    with open(INPUT_JSON, encoding='utf-8') as f:
        items = json.load(f)

    # フィルタ: source='none' かつ cn != ''
    targets = [
        item for item in items
        if item.get('source') == 'none' and item.get('cn', '') != ''
    ]

    targets.sort(key=lambda x: x['amount'], reverse=True)

    total_unlabeled     = sum(1 for item in items if item.get('source') == 'none')
    total_unlabeled_amt = sum(item['amount'] for item in items if item.get('source') == 'none')
    total_count  = len(targets)
    total_amount = sum(item['amount'] for item in targets)

    # typeCode 別集計
    tc_summary: dict[str, dict] = defaultdict(lambda: {'count': 0, 'amount': 0, 'names': []})
    for item in targets:
        tc = pick_primary_typecode(item.get('typeCodes', []))
        label = KTYPE_LABEL.get(tc, f'不明({tc})') if tc else '（typeCode なし・cn あり）'
        key = f'{tc} {label}' if tc else label
        tc_summary[key]['count']  += 1
        tc_summary[key]['amount'] += item['amount']

    # ── コンソール出力 ──────────────────────────────────────────
    SEP = '─' * 60
    print()
    print('=== ラベルなし・法人番号あり 支出先調査 ===')
    print(f'入力: {INPUT_JSON}')
    print()
    print(f'未ラベル総数         : {total_unlabeled:,}件 / {to_cho(total_unlabeled_amt)}')
    print(f'  うち 法人番号あり  : {total_count:,}件 / {to_cho(total_amount)}')
    print(f'  うち 法人番号なし  : {total_unlabeled - total_count:,}件 / '
          f'{to_cho(total_unlabeled_amt - total_amount)}')
    print()
    print(SEP)
    print('typeCode（代表）別 内訳（金額降順）')
    print(SEP)
    for key, stat in sorted(tc_summary.items(), key=lambda x: -x[1]['amount']):
        print(f'  {key:<30s}: {stat["count"]:5,}件  {to_cho(stat["amount"])}')

    print()
    print(SEP)
    print(f'上位 50件（金額降順）')
    print(SEP)
    for i, item in enumerate(targets[:50], 1):
        tc    = ','.join(item.get('typeCodes', []))
        print(f'  {i:3}. {item["name"][:35]:<35s}  {to_oku(item["amount"]):>12s}  cn={item["cn"]}  tc=[{tc}]')

    # ── CSV 出力 ──────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            '支出先名', '金額（円）', '件数', '法人番号', 'typeCodes', '代表typeCode', '法人種別名称'
        ])
        for item in targets:
            type_codes = item.get('typeCodes', [])
            tc_primary = pick_primary_typecode(type_codes)
            tc_label   = KTYPE_LABEL.get(tc_primary, '') if tc_primary else ''
            writer.writerow([
                item['name'],
                item['amount'],
                item['count'],
                item.get('cn', ''),
                ','.join(type_codes),
                tc_primary,
                tc_label,
            ])

    print()
    print(f'出力 CSV: {OUTPUT_CSV}  ({total_count:,}件)')


if __name__ == '__main__':
    main()
