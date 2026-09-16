"""Freeze raw multiplier table rows from the official PDF (requires PyMuPDF).

Run: python scripts/freeze-ef2026-reference.py
No model constants are imported. Japanese PDF glyph encoding is broken; numeric
cells and table positions are preserved, with the original pages for review.
"""
from pathlib import Path
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
import fitz

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/ef2026'
out.mkdir(parents=True, exist_ok=True)
url = 'https://www5.cao.go.jp/keizai3/econome/ef2rrrrrr-summary.pdf'
raw = urllib.request.urlopen(url).read()
pdf = fitz.open(stream=raw, filetype='pdf')
excerpt = fitz.open()
excerpt.insert_pdf(pdf, from_page=10, to_page=12)
excerpt.save(out / 'multiplier-pages.pdf', garbage=4, deflate=True, no_new_id=True)
tables = {}
for page, names in [(10, ['governmentOneYear', 'government']), (11, ['corporate', 'household']), (12, ['consumptionTax'])]:
    lines = pdf[page].get_text(sort=True).splitlines()
    groups = []
    i = 0
    while i < len(lines):
        if lines[i] == '1' and i + 44 < len(lines):
            block = lines[i:i + 45]
            if all(block[y * 9] == str(y + 1) for y in range(5)) and all(re.fullmatch(r'-?\d+\.\d+', block[y * 9 + c]) for y in range(5) for c in range(1, 9)):
                groups.append([[float(block[y * 9 + c]) for c in range(1, 9)] for y in range(5)])
                i += 45
                continue
        i += 1
    assert len(groups) >= 2 * len(names), (page, len(groups))
    for j, name in enumerate(names):
        tables[name] = {'page': page + 1, 'sign': -1 if name in ['household', 'corporate', 'consumptionTax'] else 1,
                        'activityRows': groups[2*j], 'priceLabourRows': groups[2*j+1]}
data = {'activityColumns': ['gdp', 'consumption', 'investment', 'housing', 'government', 'exports', 'imports', 'exchangeRate'],
        'priceLabourColumns': ['potentialGdp', 'gap', 'deflator', 'prices', 'shortRate', 'longRate', 'unemployment', 'employment'], 'tables': tables}
rows = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode()
(out / 'rows.json').write_bytes(rows)
manifest = {'url': url, 'retrievedOn': datetime.now(timezone.utc).date().isoformat(),
            'sourceSha256': hashlib.sha256(raw).hexdigest(), 'pdfPages': [11, 12, 13],
            'files': {name: hashlib.sha256((out / name).read_bytes()).hexdigest() for name in ['rows.json', 'multiplier-pages.pdf']},
            'note': 'Raw published experiment signs. Tax increases are negated in model. Labour-force and hours zeros are assumptions, absent from these tables.'}
(out / 'manifest.json').write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
