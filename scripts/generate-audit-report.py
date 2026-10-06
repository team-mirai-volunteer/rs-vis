"""Collect the Board of Audit of Japan's annual audit report findings (決算検査報告) and link them to RS projects.

Source: 会計検査院 検査報告データベース (report.jbaudit.go.jp), 公共データ利用規約 第1.0版.
Pages are cached under data/raw/audit-report/ (git-ignored); one page per finding, fields in <dt>/<dd> lists.
Inputs from this repo:
  public/data/mof-rs-kou-moku-linkage-{2024,2025,2026}.json(.gz)   RS project ↔ 組織・項
  scripts/data/audit-report-matches.json                           reviewed finding → pid table
Output:
  public/data/audit-report.json(.gz)
Prints automatic candidates for findings that are not in the reviewed table yet.

HTML processing and JSON generation only; no UI or API logic here.
"""
from __future__ import annotations

import gzip
import html as htmllib
import json
import re
import sys
import time
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

BASE = 'https://report.jbaudit.go.jp/org/'
RAW = Path('data/raw/audit-report')
OUT = Path('public/data/audit-report.json')
MATCHES = Path('scripts/data/audit-report-matches.json')
LINKAGE_YEARS = (2024, 2025, 2026)
# 決算年度（西暦）→ 検査報告データベースの年度ディレクトリ・ファイル名の接頭辞
REPORTS = {
    2023: {'era': '令和5年度', 'dir': 'r05', 'prefix': '2023-r05'},
    2024: {'era': '令和6年度', 'dir': 'r06', 'prefix': '2024-r06'},
}
# 個別の指摘として取り込む事項種別（第3章 個別の検査結果）。過年度の処置状況の報告は除く
KINDS = ('不当事項', '意見を表示し又は処置を要求した事項', '本院の指摘に基づき当局において改善の処置を講じた事項')


def fetch(rel: str) -> str:
    path = RAW / rel
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(BASE + rel, headers={'User-Agent': 'rs-vis data pipeline (+https://rs-vis.team-mir.ai)'})
        with urllib.request.urlopen(req, timeout=60) as res:
            path.write_bytes(res.read())
        time.sleep(0.5)
    return path.read_text(encoding='utf-8', errors='replace')


def norm(s: str) -> str:
    return unicodedata.normalize('NFKC', s)


def text(fragment: str) -> str:
    return re.sub(r'\s+', ' ', norm(htmllib.unescape(re.sub(r'<[^>]+>', ' ', fragment)))).strip()


def parse_page(page: str) -> dict:
    keywords = re.search(r'name="keywords" content="([^"]*)"', page)
    parts = norm(keywords.group(1)).split(',') if keywords else []
    title = re.split(r'\s*\|\s*', text(re.search(r'<title>(.*?)</title>', page, re.S).group(1)))[0]
    fields = [(text(dt), text(dd)) for dt, dd in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', page, re.S)]
    return {'keywords': parts, 'title': title, 'fields': fields, 'body': text(page)}


def subject(fields: list[tuple[str, str]]) -> dict | None:
    """会計名及び科目: 「一般会計 （組織）消費者庁 （項）消費者政策費 …」"""
    value = next((v for k, v in fields if k.endswith('会計名及び科目')), None)
    if not value:
        return None
    return {
        'account': value.split(' ')[0],
        'organizations': re.findall(r'\(組織\)\s*(\S+?)(?=\s|\(|$)', value),
        'sections': re.findall(r'\(項\)\s*(\S+?)(?=\s|\(|$)', value),
    }


def programs(fields: list[tuple[str, str]], title: str) -> list[str]:
    """補助金・交付金・事業の名前。照合の手がかり（画面には出さない）"""
    names = [v for k, v in fields if re.fullmatch(r'(補助事業|交付金事業|国庫補助金等|委託事業|事業名|補助事業等|間接補助事業)', k)]
    head = re.sub(r'^\(\d+\)(?:―\(\d+\))?\s*', '', title)
    head = re.sub(r'^雇用保険の', '', head)
    lead = re.match(r'^(.+?)(?:が過大|が適正で|の支給が|の交付|の経理|により|の実施に当たり|において|の補助対象|の交付対象|の補助の対象|を過大|を補助|で取得|について)', head)
    if lead and re.search(r'(補助金|交付金|負担金|給付金|助成金|奨励金|事業|給付費|調整交付金)', lead.group(1)):
        names.append(lead.group(1))
    out = []
    for n in names:
        out += [p for p in re.split(r'[、,]|及び', n) if len(p) >= 4]
    return list(dict.fromkeys(out))


def amount(kind: str, fields: list[tuple[str, str]], body: str) -> tuple[str | None, int | None]:
    """不当事項の「不当と認める…」の額（国費相当があればそれ）。意見・処置要求や改善処置の金額は
    開差額・背景金額など事項ごとに意味が違い、並べて比べられないので取らない"""
    if kind != '不当事項':
        return None, None
    candidates = [(k, v) for k, v in fields if k.startswith('不当と認める') and '額' in k]
    candidates += [(m.group(1), m.group(2)) for m in re.finditer(r'(不当と認める\S{0,25}?)\s*([\d,]+円)', body)]
    national = [c for c in candidates if re.search(r'国庫|補助金|交付金|負担金|国費', c[0])]
    pick = (national or candidates)[:1]
    if not pick:
        return None, None
    label, value = pick[0]
    return f'{label} {value.split("(")[0].strip()}', yen(value)


def yen(value: str) -> int | None:
    m = re.match(r'\s*(?:(\d[\d,]*)億)?(?:(\d[\d,]*)万)?(\d[\d,]*)?余?円', value)
    if not m or not any(m.groups()):
        return None
    oku, man, rest = (int(g.replace(',', '')) if g else 0 for g in m.groups())
    return oku * 10**8 + man * 10**4 + rest


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
    s = re.sub(r'[（(][^）)]*[）)]', '', norm(name))
    s = re.sub(r'\s', '', s)
    s = re.sub(r'国庫(?=負担金|補助金)', '', s)
    return re.sub(r'(の交付対象事業|事業費等補助金|事業費補助金|に必要な経費|補助金|交付金|負担金|助成金|給付金|奨励金|事業|経費|費)+$', '', s)


MINISTRY_ALIASES = {'内閣府': ('内閣府', 'こども家庭庁', '消費者庁', 'デジタル庁', '警察庁'), '国土交通省': ('国土交通省', '観光庁', '海上保安庁')}


def candidates(item: dict, links: list[dict], projects: dict[int, dict]) -> list[int]:
    subj = item['subject'] or {'organizations': [], 'sections': []}
    by_section = {l['projectId'] for l in links if norm(l['sectionName']) in subj['sections']
                  and (not subj['organizations'] or norm(l['mofOrganization']) in subj['organizations'])}
    ministry = re.sub(r'\(.*$', '', item['ministry'])
    allowed = MINISTRY_ALIASES.get(ministry, (ministry,))
    keys = [k for k in (core(p) for p in item['programs']) if len(k) >= 4]
    by_name = {pid for pid, p in projects.items()
               if any(a in p['ministry'] for a in allowed)
               and any(k in core(p['name']) or (len(core(p['name'])) >= 5 and core(p['name']) in k) for k in keys)}
    both = by_section & by_name
    if both:
        return sorted(both)
    return sorted(by_name) if 0 < len(by_name) <= 3 else []


def collect(year: int, conf: dict) -> list[dict]:
    mokuji = fetch(f"{conf['dir']}/{conf['prefix']}-mokuji.htm")
    files = list(dict.fromkeys(re.findall(rf'href="(?:\./)?({conf["prefix"]}-\d{{4}}-\d+\.htm)"', mokuji)))
    items, inherited = [], None
    for f in files:
        page = parse_page(fetch(f"{conf['dir']}/{f}"))
        kw = page['keywords']
        if len(kw) < 5 or not kw[1].startswith('第3章'):
            continue
        kind = kw[4]
        subj = subject(page['fields'])
        # 府省ごとの不当事項は、まとめのページに会計名があり、個別のページは書かない。直前のまとめから引き継ぐ
        if subj:
            inherited = (kw[3], subj)
        elif inherited and inherited[0] == kw[3]:
            subj = inherited[1]
        # 府省ごとのまとめ（「補助事業の実施及び経理が不当と認められるもの」）と、前ページの続き（【当局が講じた処置】など）は指摘として数えない
        if kind not in KINDS or page['title'].startswith('【') or re.fullmatch(r'.*の実施及び経理が不当と認められるもの', page['title']):
            continue
        label, value = amount(kind, page['fields'], page['body'])
        items.append({
            'id': f'{year}-{f.split("-", 2)[2].removesuffix(".htm")}',
            'fiscalYear': year, 'era': conf['era'], 'ministry': re.sub(r'^第\d+\s*', '', kw[3]), 'kind': kind,
            'category': kw[5] if len(kw) > 5 else None, 'title': page['title'],
            'subject': subj, 'programs': programs(page['fields'], page['title']),
            'amountText': label, 'amount': value, 'url': f"{BASE}{conf['dir']}/{f}",
        })
    return items


def main() -> None:
    table = json.loads(MATCHES.read_text(encoding='utf-8')) if MATCHES.exists() else {'cases': {}, 'reviewedBy': None}
    reviewed = table['cases']
    links, projects = load_linkage()
    items, pending = [], []
    for year, conf in REPORTS.items():
        for item in collect(year, conf):
            review = reviewed.get(item['id'])
            if review is not None:
                item.update(pids=review['pids'], match='reviewed' if review['pids'] else 'none', matchNote=review.get('note'))
            else:
                # 対応表に無い指摘は結びつけない。自動の候補があれば確認用に出力する
                item.update(pids=[], match='none', matchNote=None)
                pending.append((item, candidates(item, links, projects)))
            items.append(item)
    by_pid: dict[str, list[str]] = {}
    for item in items:
        for pid in item['pids']:
            by_pid.setdefault(str(pid), []).append(item['id'])
    data = {
        'metadata': {
            'source': '会計検査院「決算検査報告」（検査報告データベース）第3章 個別の検査結果',
            'sourceUrl': 'https://report.jbaudit.go.jp/',
            'license': '公共データ利用規約（第1.0版）。出典：会計検査院Webサイト（加工して作成）',
            'retrievedOn': date.today().isoformat(),
            'unit': '金額は円。指摘の金額は事項ごとの表記（不当と認める額・指摘金額）のまま',
            'matching': '指摘と予算事業IDの対応は、項と補助金・事業名から作った候補を確認して作成（scripts/data/audit-report-matches.json）',
            'reviewedBy': table.get('reviewedBy'),
        },
        'items': items,
        'byPid': by_pid,
    }
    text_out = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    OUT.write_text(text_out, encoding='utf-8', newline='\n')
    with gzip.open(str(OUT) + '.gz', 'wb', compresslevel=9) as f:
        f.write(text_out.encode('utf-8'))
    print(f'{len(items)} findings, {sum(1 for i in items if i["match"] == "reviewed")} linked, {sum(1 for _, c in pending if c)} unreviewed with candidates')
    for item, pids in pending:
        if pids:
            names = '; '.join(f'{pid}:{projects[pid]["name"]}' for pid in pids)
            print(f'  {item["id"]} [{item["ministry"]}] {item["title"][:70]} | 項={(item["subject"] or {}).get("sections")} 名={item["programs"][:3]} → {names}')


if __name__ == '__main__':
    sys.exit(main())
