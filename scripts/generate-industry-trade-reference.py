"""2020 national IO benchmark. Requires numpy and openpyxl; no application dependencies.

python scripts/generate-industry-trade-reference.py [downloaded.xlsx]
Import allocation is proportional by product, not an observed factory sourcing matrix.
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
codes = list(sheet[1][2:110])
rows = sheet[3:111]
assert len(rows) == 108 and [r[0] for r in rows] == codes
# Column codes: 119 domestic demand total, 121 exports, 124 imports excl. tax,
# 127 imports total incl. tax, 129 domestic production. Fail loudly on layout changes.
COLUMNS = {119: '790', 121: '810', 124: '841', 127: '870', 129: '970'}
assert all(sheet[1][col] == code for col, code in COLUMNS.items()), {col: sheet[1][col] for col in COLUMNS}
cell = lambda row, col: row[col] or 0
x = np.array([r[129] for r in rows], dtype=float)
a = np.array([[r[j] or 0 for j in range(2, 110)] for r in rows], dtype=float) / x
# Tax-inclusive import penetration allocates the domestic-production transactions.
# Cash import coefficients exclude tariffs and import commodity taxes (domestic receipts).
m = np.array([min(1, max(0, -cell(r, 127) / cell(r, 119))) if cell(r, 119) else 0 for r in rows])
cash = np.array([max(0, -cell(r, 124) / cell(r, 119)) if cell(r, 119) else 0 for r in rows])
inverse = np.linalg.inv(np.eye(len(rows)) - (1 - m[:, None]) * a)
j = codes.index('321')
# Fix electronics gross production at one yen, rather than one yen of final demand.
production = inverse[:, j] / inverse[j, j]
r = rows[j]
export_share = cell(r, 121) / x[j]
imports = -cell(r, 124)
domestic_market = x[j] - cell(r, 121) + imports
result = {
    'sourceUrl': URL, 'sourceName': '令和2年産業連関表・生産者価格評価表・108部門',
    'referenceYear': 2020, 'sectorCode': '321', 'sectorName': r[1],
    'sha256': hashlib.sha256(raw).hexdigest(),
    'amountUnit': '10億円',
    'production': x[j], 'exports': cell(r, 121), 'importsExcludingTax': imports,
    'domesticMarketExcludingImportTax': domestic_market,
    'exportShare': export_share,
    'domesticReplacementShare': imports / domestic_market,
    'directOperatingImportShare': float(cash @ a[:, j]),
    'operatingImportShare': float(cash @ a @ production),
    'method': '競争輸入型の比例配分。国内投入逆行列の321列を対角要素で割り、電子デバイス生産1円当たりの国内供給網輸入を算出。関税・輸入品商品税は海外支払から除外。国内置換率は国内市場の輸入浸透率を代用する仮定。',
}
assert all(0 <= result[k] <= 1 for k in ('exportShare', 'domesticReplacementShare', 'operatingImportShare'))
target = Path(__file__).resolve().parents[1] / 'app/lib/fiscal-space/data/industry-trade-reference.json'
target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
