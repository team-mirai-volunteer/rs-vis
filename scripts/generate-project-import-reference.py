"""Estimate investment imports from the 2020 IO table (numpy/openpyxl required).

Usage: python scripts/generate-project-import-reference.py [downloaded.xlsx]
The national investment basket is a provisional proxy, not a project survey.
"""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.request
import numpy as np
import openpyxl

URL = 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040187026&fileKind=0'
raw = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(URL, timeout=60).read()
sheet = list(openpyxl.load_workbook(io.BytesIO(raw), data_only=True).active.values)
rows = sheet[3:111]
assert [r[0] for r in rows] == list(sheet[1][2:110])
assert all(sheet[1][col] == code for col, code in {115: '741', 116: '751', 119: '790', 124: '841', 127: '870', 129: '970'}.items())
x = np.array([r[129] for r in rows], dtype=float)
a = np.array([[r[j] or 0 for j in range(2, 110)] for r in rows], dtype=float) / x
m = np.array([min(1, max(0, -(r[127] or 0) / r[119])) if r[119] else 0 for r in rows])
cash = np.array([max(0, -(r[124] or 0) / r[119]) if r[119] else 0 for r in rows])
inverse = np.linalg.inv(np.eye(len(rows)) - (1 - m[:, None]) * a)
# Negative entries (e.g. recovered scrap) are net disposals, not new procurement.
investment = np.maximum(0, np.array([(r[115] or 0) + (r[116] or 0) for r in rows], dtype=float))
basket = investment / investment.sum()
direct = float(cash @ basket)
upstream = float(cash @ a @ inverse @ ((1 - m) * basket))
result = {
    'sourceUrl': URL, 'referenceYear': 2020,
    'sha256': hashlib.sha256(raw).hexdigest(),
    'directImportShare': direct, 'upstreamImportShare': upstream,
    'capexImportShare': direct + upstream,
    'method': '公的・民間の国内総固定資本形成を品目別に合算し、負の純処分額を除いて調達構成を正規化。輸入浸透率による直接輸入＋国内投入逆行列による供給網輸入。関税・輸入品商品税は海外支払から除外。全事業への適用は全国平均による代理仮定で、事業別調達率の実測ではない。',
}
assert 0 < result['capexImportShare'] < 1
target = Path(__file__).resolve().parents[1] / 'app/lib/fiscal-space/data/project-import-reference.json'
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
