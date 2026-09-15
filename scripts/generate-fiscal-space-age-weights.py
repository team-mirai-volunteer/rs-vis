"""Extract adjusted household weights from the same 2024 age survey as burden data."""
import hashlib
import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
raw = ROOT / 'data/raw/tax-burden/kakei-2024-table3-2-age.xlsx'
base = ROOT / 'app/lib/fiscal-space'
age = json.loads((base / 'age-burden-2024.json').read_text(encoding='utf-8'))
sheet = openpyxl.load_workbook(raw, data_only=True)['勤労']
rows = list(sheet.values)
distribution = next(row for row in rows if row[11] == '世帯数分布(抽出率調整)')
header = next(row for row in rows if row[13] == '平均' and row[14] == '～34歳')
weights = []
for col, group in enumerate(age['groups'][0]['classes'], start=14):
    assert header[col] == group['label'], (header[col], group['label'])
    weight = distribution[col]
    assert isinstance(weight, (int, float)) and weight > 0
    weights.append({'label': group['label'], 'weight': weight})
result = {
    'metadata': {
        'sourceUrl': age['metadata']['sourceUrl'],
        'referenceYear': 2024,
        'population': age['groups'][0]['population'],
        'sourceRow': '世帯数分布(抽出率調整)',
        'unit': '全対象世帯10,000に対する分布（公表値の丸めあり）',
        'rawSha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
        'note': '集計世帯数ではなく抽出率調整済み分布を使用。対象年齢階級の重み合計で正規化する。',
    },
    'weights': weights,
}
(base / 'age-burden-weights-2024.json').write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Generated adjusted weights for', len(weights), 'age classes')
