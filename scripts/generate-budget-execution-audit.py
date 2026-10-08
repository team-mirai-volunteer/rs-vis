"""Collect the Ministry of Finance budget execution surveys (予算執行調査) and link each case to RS projects.

Sources (mof.go.jp, 公共データ利用規約 第1.0版), cached under data/raw/budget-execution-audit/ (git-ignored):
  case lists (HTML)         fy{YYYY}/sy{..}/{..}d.html   number, ministry, case name, link to the 総括調査票 PDF
  総括調査票 (PDF, page 1)    府省名・組織・会計・項・目・調査対象予算額・調査主体
  反映状況票 (PDF, page 1)    反映額 for the following year's budget (published each January)
Inputs from this repo:
  public/data/mof-rs-kou-moku-linkage-{2024,2025,2026}.json(.gz)   RS project ↔ 組織・項・目
  scripts/data/budget-execution-audit-matches.json                 reviewed case → pid table
Output:
  public/data/budget-execution-audit.json(.gz)
Prints, for cases not yet in the reviewed table, the automatic candidates to review.

Needs `pdftotext` (poppler) on PATH. HTML/PDF processing and JSON generation only; no UI or API logic here.
"""
from __future__ import annotations

import gzip
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

BASE = 'https://www.mof.go.jp/policy/budget/topics/budget_execution_audit/'
RAW = Path('data/raw/budget-execution-audit')
OUT = Path('public/data/budget-execution-audit.json')
MATCHES = Path('scripts/data/budget-execution-audit-matches.json')
LINKAGE_YEARS = (2024, 2025, 2026)

# 調査年度（西暦の会計年度）→ 調査結果の一覧ページと、翌年度予算案への反映状況の一覧ページ
SURVEYS = {
    2024: {'era': '令和6年度', 'results': ['fy2024/sy0606/0606d.html', 'fy2024/sy0610/0610d.html'], 'reflection': 'fy2024/hanei/0701b.html'},
    2025: {'era': '令和7年度', 'results': ['fy2025/sy0706/0706d.html', 'fy2025/sy0710/0710d.html'], 'reflection': 'fy2025/hanei/0801b.html'},
    2026: {'era': '令和8年度', 'results': ['fy2026/sy0806/0806d.html'], 'reflection': None},
}


def fetch(rel: str) -> Path:
    path = RAW / rel
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(BASE + rel, headers={'User-Agent': 'rs-vis data pipeline (+https://rs-vis.team-mir.ai)'})
        with urllib.request.urlopen(req, timeout=60) as res:
            path.write_bytes(res.read())
        time.sleep(0.5)
    return path


def norm(s: str) -> str:
    """PDF text uses Kangxi radicals (⼀⺟⼦) and full-width forms; NFKC folds them to ordinary characters."""
    return unicodedata.normalize('NFKC', s)


def read_html(path: Path) -> str:
    raw = path.read_bytes()
    m = re.search(rb'charset=["\']?([\w-]+)', raw[:2000], re.I)
    enc = (m.group(1).decode().lower() if m else 'utf-8').replace('shift_jis', 'cp932').replace('x-sjis', 'cp932')
    return raw.decode(enc, errors='replace')


def text_of(html: str) -> str:
    return norm(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html))).strip()


def list_cases(index_rel: str) -> list[dict]:
    """Rows of a case list: (number) | [ministry] | case name linked to its PDF."""
    html = read_html(fetch(index_rel))
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.S):
        num = re.search(r'\((\d+)\)', text_of(re.search(r'<th[^>]*>(.*?)</th>', tr, re.S).group(1)) if '<th' in tr else '')
        link = re.search(r'<a href="(\./)?(\d{2})\.pdf">(.*?)</a>', tr, re.S)
        if not num or not link:
            continue
        ministries = re.findall(r'\[([^\]]+)\]', text_of(tr))
        title = re.sub(r'\(PDF:[^)]*\)', '', text_of(link.group(3))).strip()
        rows.append({'no': int(num.group(1)), 'ministries': ministries, 'title': title,
                     'pdf': index_rel.rsplit('/', 1)[0] + f'/{link.group(2)}.pdf'})
    return rows


def pdf_page1(rel: str) -> str:
    path = fetch(rel)
    out = subprocess.run(['pdftotext', '-enc', 'UTF-8', '-layout', '-l', '1', str(path), '-'], capture_output=True, check=True)
    return norm(out.stdout.decode('utf-8', errors='replace'))


# Header labels of the 総括調査票. A value runs from its label to the next label on the flattened header text.
LABELS = ('府省名', '組織', '会計', '項', '目', '調査対象予算額', '調査主体', '取りまとめ財務局', '共同調査')
LABEL_RE = '|'.join(rf'(?<![^\s]){l}(?![^\s])' for l in LABELS)


def field(flat: str, label: str) -> str | None:
    m = re.search(rf'(?<![^\s]){label}\s+(.+?)(?=\s(?:{LABEL_RE})\s|$)', flat)
    if not m:
        return None
    value = re.sub(r'\s*\(参考.*$', '', m.group(1)).strip()
    value = re.sub(r'\s1$', '', value)  # ①調査事案の概要 の「①」（NFKC で 1）が残る
    # Multi-column headers interleave cells; a value that swallowed another label or body text is dropped, not guessed.
    if not value or len(value) > 60 or re.search(LABEL_RE, value) or '・(' in value:
        return None
    return value


def survey_body(value: str | None) -> str | None:
    """「本省調査」か「共同調査（○○財務局）」に揃える。読み取れないものは None"""
    if not value:
        return None
    bureau = re.search(r'本省と(\S+?)の共同調査', value)
    if bureau:
        return f'共同調査（{bureau.group(1)}）'
    if value.startswith('共同'):
        return '共同調査'
    return '本省調査' if value.startswith('本省') else None


def parse_summary(text: str) -> dict:
    """Header block of the 総括調査票: everything before 調査事案の概要 (NFKC turns ① into 1, so split on the words)."""
    head = text.split('調査事案の概要', 1)[0]
    flat = re.sub(r'\s+', ' ', head) + ' '
    budget = field(flat, '調査対象予算額')
    amount = re.match(r'(.*?百万円(?:の内数)?(?:\s?ほか)?)', budget or '')
    return {
        'organization': field(flat, '組織'),
        'account': field(flat, '会計'),
        'section': field(flat, '項'),
        'subItem': field(flat, '目'),
        'budgetText': amount.group(1) if amount else None,
        'surveyBody': survey_body(field(flat, '調査主体')),
    }


def parse_reflection(text: str) -> str:
    """反映額 is the last column of the first data row (million yen). It is always a cut (▲) or 「－」;
    when the cell is a dash the row can end with another column's number, so anything but ▲ counts as 「－」.
    REFLECTION_TOTALS checks the result against the published 反映額一覧."""
    lines = [l for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if '府省名' in line and '反映額' in line:
            for row in lines[i + 1:i + 4]:
                m = re.search(r'▲\s*([\d,]+)\s*$', row)
                if m:
                    return f'▲{m.group(1)}'
    return '－'


# 反映額一覧（hanei/32.pdf・31.pdf）の合計（百万円）。各行を四捨五入しているので数百万円の差は出る
REFLECTION_TOTALS = {2024: -4179, 2025: -689}


def reflection_amount(text: str | None) -> int | None:
    if not text or text in ('―', '-', '－'):
        return None
    value = int(text.replace('▲', '').replace(',', '')) * 1_000_000
    return -value if text.startswith('▲') else value


def load_linkage() -> tuple[list[dict], dict[int, dict]]:
    links, projects = [], {}
    for year in LINKAGE_YEARS:
        path = Path(f'public/data/mof-rs-kou-moku-linkage-{year}.json')
        data = json.loads(path.read_text(encoding='utf-8') if path.exists() else gzip.decompress(Path(f'{path}.gz').read_bytes()).decode('utf-8'))
        links += data['links']
        for p in data['projects']:
            projects[p['projectId']] = {'name': p['projectName'], 'ministry': p['projectMinistry']}
    return links, projects


def core(name: str) -> str:
    """Comparable form of a case or project name: no spaces, no bracketed qualifiers, no generic tail."""
    s = re.sub(r'[（(][^）)]*[）)]', '', norm(name))
    s = re.sub(r'\s', '', s)
    return re.sub(r'(に必要な経費|等?事業費?補助金|補助金|交付金|負担金|事業|経費)$', '', s)


def candidates(case: dict, links: list[dict], projects: dict[int, dict]) -> list[int]:
    by_subject = {l['projectId'] for l in links
                  if case['section'] and norm(l['sectionName']) == case['section']
                  and (not case['subItem'] or norm(l['subItemName']) == case['subItem'])
                  and (not case['organization'] or case['organization'] in (norm(l['mofOrganization']), norm(l['mofMinistry'])))}
    key = core(case['title'])
    by_name = {pid for pid, p in projects.items() if len(key) >= 3 and (key in core(p['name']) or core(p['name']) in key and len(core(p['name'])) >= 4)}
    both = by_subject & by_name
    if both:
        return sorted(both)
    if len(by_name) == 1:
        return sorted(by_name)
    return sorted(by_subject) if len(by_subject) <= 5 else []


def main() -> None:
    try:
        subprocess.run(['pdftotext', '-v'], capture_output=True, check=False)
    except FileNotFoundError:
        sys.exit('pdftotext (poppler) が必要です')
    table = json.loads(MATCHES.read_text(encoding='utf-8')) if MATCHES.exists() else {'cases': {}, 'reviewedBy': None}
    reviewed = table['cases']
    links, projects = load_linkage()
    cases, pending = [], []
    for year, conf in SURVEYS.items():
        reflections = {}
        if conf['reflection']:
            for row in list_cases(conf['reflection']):
                reflections[row['no']] = row['pdf']
        for index in conf['results']:
            for row in list_cases(index):
                summary = parse_summary(pdf_page1(row['pdf']))
                ref_pdf = reflections.get(row['no'])
                ref_text = parse_reflection(pdf_page1(ref_pdf)) if ref_pdf else None
                case = {
                    'id': f'{year}-{row["no"]:02d}', 'surveyYear': year, 'era': conf['era'], 'no': row['no'],
                    'ministries': row['ministries'], 'title': row['title'], **summary,
                    'resultUrl': BASE + row['pdf'],
                    'reflectionUrl': BASE + ref_pdf if ref_pdf else None,
                    'reflectionText': ref_text, 'reflectionAmount': reflection_amount(ref_text),
                }
                review = reviewed.get(case['id'])
                if review is not None:
                    case['pids'] = review['pids']
                    case['match'] = 'reviewed' if review['pids'] else 'none'
                    case['scope'] = review.get('scope')
                    case['matchNote'] = review.get('note')
                else:
                    case['pids'], case['match'], case['scope'], case['matchNote'] = [], 'pending', None, None
                    pending.append((case, candidates(case, links, projects)))
                cases.append(case)
    for year, expected in REFLECTION_TOTALS.items():
        total = sum(c['reflectionAmount'] or 0 for c in cases if c['surveyYear'] == year) // 1_000_000
        if abs(total - expected) > 3:
            sys.exit(f'{year}年度の反映額の合計 {total} 百万円が公表の合計 {expected} 百万円と合いません')
    by_pid: dict[str, list[str]] = {}
    for c in cases:
        for pid in c['pids']:
            by_pid.setdefault(str(pid), []).append(c['id'])
    data = {
        'metadata': {
            'source': '財務省「予算執行調査」（調査結果の総括調査票・予算への反映状況）',
            'sourceUrl': BASE,
            'license': '公共データ利用規約（第1.0版）。出典：財務省ウェブサイト（加工して作成）',
            'retrievedOn': date.today().isoformat(),
            'unit': '反映額は円（公表は百万円単位）。調査対象予算額は公表の文言のまま',
            'matching': '事案と予算事業IDの対応は、項・目と事案名から作った候補を確認して作成（scripts/data/budget-execution-audit-matches.json）',
            'reviewedBy': table.get('reviewedBy'),
        },
        'cases': cases,
        'byPid': by_pid,
    }
    text = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    OUT.write_text(text, encoding='utf-8', newline='\n')
    with gzip.open(str(OUT) + '.gz', 'wb', compresslevel=9) as f:
        f.write(text.encode('utf-8'))
    print(f'{len(cases)} cases, {sum(1 for c in cases if c["match"] == "reviewed")} linked, {len(pending)} pending review')
    for case, pids in pending:
        names = '; '.join(f'{pid}:{projects[pid]["name"]}' for pid in pids) or '（候補なし）'
        print(f'  {case["id"]} [{"・".join(case["ministries"])}] {case["title"]} | 組織={case["organization"]} 項={case["section"]} 目={case["subItem"]} → {names}')


if __name__ == '__main__':
    main()
