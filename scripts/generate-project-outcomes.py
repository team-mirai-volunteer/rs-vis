#!/usr/bin/env python3
"""
成果目標・実績（3-1）と点検・評価（4-1）、関連事業（1-5）を事業単位に集約する。

背景:
  これまでパイプラインは 1系（基本情報）・2系（予算執行）・5系（支出先）しか取り込んでおらず、
  成果指標と点検所見を一切読んでいなかった。そのため AI 評価の「検証可能性」軸が
  事業概要の散文に数値が書かれているかで採点され、実際には達成率まで登録されている事業を
  「実績がない」と誤判定していた。

入力:
  data/year_{YEAR}/3-1_RS_{YEAR}_効果発現経路_目標・実績.csv   （long format・約13万行）
  data/year_{YEAR}/4-1_RS_{YEAR}_点検・評価.csv
  data/year_{YEAR}/1-5_RS_{YEAR}_基本情報_関連事業.csv

出力:
  public/data/rs{YEAR}-project-outcomes.json

3-1 の構造:
  指標1つにつき「1.目標年度 / 2.目標値 / 3.実績値 / 4.達成率」の4行があり、
  それぞれ 2007〜2060 の年度列に値が入る。番号(列16)で指標を束ねる。

実行:
  python3 scripts/generate-project-outcomes.py [--year 2025]
"""
import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

parser = argparse.ArgumentParser(description='成果目標・実績／点検・評価の集約')
parser.add_argument('--year', type=int, default=2025)
parser.add_argument('--recent', type=int, default=6, help='保持する直近年度数（既定6）')
args = parser.parse_args()

YEAR = args.year
ROOT = Path(__file__).parent.parent
SRC = ROOT / 'data' / f'year_{YEAR}'
OUT = ROOT / 'public' / 'data' / f'rs{YEAR}-project-outcomes.json'

GOALS_CSV = SRC / f'3-1_RS_{YEAR}_効果発現経路_目標・実績.csv'
LINKS_CSV = SRC / f'3-2_RS_{YEAR}_効果発現経路_目標のつながり.csv'
REVIEW_CSV = SRC / f'4-1_RS_{YEAR}_点検・評価.csv'
RELATED_CSV = SRC / f'1-5_RS_{YEAR}_基本情報_関連事業.csv'

# 3-1 の列位置
C_PID, C_NO, C_KIND = 2, 16, 17
C_PERIOD, C_GOAL_TYPE, C_GOAL, C_INDICATOR, C_UNIT, C_DIRECTION = 18, 19, 20, 21, 22, 23
C_SOURCE, C_QUAL_REASON, C_QUAL_RESULT, C_ROWKIND = 24, 25, 26, 27
C_YEAR_START = 28

ROWKIND = {'1.目標年度': 'targetYear', '2.目標値': 'target', '3.実績値': 'actual', '4.達成率': 'rate'}


def read_csv(path):
    """RSシステムのCSVは UTF-8 BOM。壊れた行は落とさず置換して読む。"""
    if not path.exists():
        print(f'  [warn] {path.name} が見つかりません', file=sys.stderr)
        return None, []
    with io.open(path, encoding='utf-8-sig', errors='replace', newline='') as f:
        rd = csv.reader(f)
        header = next(rd)
        return header, list(rd)


def num(v):
    try:
        return float(str(v).replace(',', ''))
    except (TypeError, ValueError):
        return None


def build_goals(recent_n):
    header, rows = read_csv(GOALS_CSV)
    if header is None:
        return {}
    years = [(i, header[i]) for i in range(C_YEAR_START, len(header)) if header[i].strip().isdigit()]
    keep_years = [(i, y) for i, y in years if int(y) >= YEAR - recent_n]

    # (pid, 指標番号) ごとに4行を束ねる
    bucket = defaultdict(dict)
    meta = {}
    for r in rows:
        if len(r) <= C_ROWKIND:
            continue
        pid, no = r[C_PID].strip(), r[C_NO].strip()
        if not pid:
            continue
        key = (pid, no)
        if key not in meta:
            meta[key] = {
                'no': no,
                'kind': r[C_KIND].strip(),
                'period': r[C_PERIOD].strip(),
                'goalType': r[C_GOAL_TYPE].strip(),
                'goal': r[C_GOAL].strip(),
                'indicator': r[C_INDICATOR].strip(),
                'unit': r[C_UNIT].strip(),
                'direction': r[C_DIRECTION].strip(),
                'source': r[C_SOURCE].strip(),
                'qualitativeResult': r[C_QUAL_RESULT].strip(),
            }
        rk = ROWKIND.get(r[C_ROWKIND].strip())
        if not rk:
            continue
        series = {y: r[i].strip() for i, y in keep_years if i < len(r) and r[i].strip()}
        if series:
            bucket[key][rk] = series

    out = defaultdict(lambda: {'indicators': [], 'counts': {}})
    for key, m in meta.items():
        pid = key[0]
        vals = bucket.get(key, {})
        # 指標名も目標文も無い空行は捨てる
        if not m['indicator'] and not m['goal']:
            continue
        latest_actual = None
        latest_rate = None
        if vals.get('actual'):
            y = max(vals['actual'], key=int)
            latest_actual = {'year': int(y), 'value': vals['actual'][y]}
        if vals.get('rate'):
            y = max(vals['rate'], key=int)
            latest_rate = {'year': int(y), 'value': num(vals['rate'][y])}
        out[pid]['indicators'].append({
            **m,
            'targetYear': vals.get('targetYear', {}),
            'target': vals.get('target', {}),
            'actual': vals.get('actual', {}),
            'rate': vals.get('rate', {}),
            'latestActual': latest_actual,
            'latestRate': latest_rate,
        })

    # 集計（AI へは件数サマリも渡して「指標があるのに実績が無い」を機械的に判定できるようにする）
    for pid, d in out.items():
        inds = d['indicators']
        by_kind = defaultdict(int)
        for i in inds:
            by_kind[i['kind'] or '不明'] += 1
        d['counts'] = {
            'total': len(inds),
            'byKind': dict(by_kind),
            'withIndicatorName': sum(1 for i in inds if i['indicator'] and i['indicator'] != '--'),
            'withTarget': sum(1 for i in inds if i['target']),
            'withActual': sum(1 for i in inds if i['actual']),
            'withRate': sum(1 for i in inds if i['rate']),
            'withSource': sum(1 for i in inds if i['source']),
            'outcomeWithActual': sum(1 for i in inds if i['kind'] == 'アウトカム' and i['actual']),
        }
    return out


def build_reviews():
    header, rows = read_csv(REVIEW_CSV)
    if header is None:
        return {}
    idx = {name: i for i, name in enumerate(header)}

    def col(r, name):
        i = idx.get(name)
        return r[i].strip() if (i is not None and i < len(r)) else ''

    out = {}
    for r in rows:
        pid = r[C_PID].strip() if len(r) > C_PID else ''
        if not pid:
            continue
        out[pid] = {
            'selfCheck': col(r, '事業所管部局による点検・改善ー点検結果'),
            'improvementDirection': col(r, '事業所管部局による点検・改善ー改善の方向性'),
            'effectAssessment': col(r, '事業所管部局による点検・改善－目標年度における効果測定に関する評価'),
            'expertYear': col(r, '外部有識者による点検ー最終実施年度'),
            'expertTarget': col(r, '外部有識者による点検ー点検対象'),
            'expertReason': col(r, '外部有識者による点検ー対象の理由'),
            'expertOpinion': col(r, '外部有識者による点検ー所見'),
            'publicProcess': col(r, '公開プロセス結果概要'),
            'teamOpinion': col(r, '行政事業レビュー推進チームの所見'),
            'teamOpinionDetail': col(r, '行政事業レビュー推進チームの所見の詳細'),
            'reflection': col(r, '所見を踏まえた改善点／概算要求における反映状況'),
            'reflectionDetail': col(r, '所見を踏まえた改善点／概算要求における反映状況の詳細'),
        }
    return out


def build_related():
    """1-5 関連事業。列は 番号 / 関連事業の事業ID / 事業名 / 関連性。空行が多いので中身のある行だけ拾う。"""
    header, rows = read_csv(RELATED_CSV)
    if header is None:
        return {}
    idx = {name: i for i, name in enumerate(header)}
    ci = idx.get('関連事業の事業ID')
    cn = idx.get('関連事業の事業名')
    cr = idx.get('関連性')
    out = defaultdict(list)
    for r in rows:
        pid = r[C_PID].strip() if len(r) > C_PID else ''
        if not pid:
            continue
        rid = r[ci].strip() if (ci is not None and ci < len(r)) else ''
        rname = r[cn].strip() if (cn is not None and cn < len(r)) else ''
        rel = r[cr].strip() if (cr is not None and cr < len(r)) else ''
        if not (rid or rname):
            continue
        out[pid].append({'projectId': rid, 'name': rname, 'relation': rel})
    return out


def build_links():
    """3-2 目標のつながり。派生元→派生先の有向グラフ。成果設計のロジックモデルそのもの。"""
    header, rows = read_csv(LINKS_CSV)
    if header is None:
        return {}
    idx = {name: i for i, name in enumerate(header)}

    def col(r, name):
        i = idx.get(name)
        return r[i].strip() if (i is not None and i < len(r)) else ''

    out = defaultdict(lambda: {'links': [], 'noMultiStageReason': ''})
    for r in rows:
        pid = r[C_PID].strip() if len(r) > C_PID else ''
        if not pid:
            continue
        src_kind = col(r, '派生元ー種別（アクティビティ・アウトプット・アウトカム）')
        dst_kind = col(r, '派生先ー種別（アクティビティ・アウトプット・アウトカム）')
        if not (src_kind or dst_kind):
            continue
        out[pid]['links'].append({
            'fromNo': col(r, '派生元ーアクティビティ・アウトプット・アウトカムの番号'),
            'fromKind': src_kind,
            'from': col(r, '派生元ーアクティビティの内容/ 活動目標／成果目標')[:80],
            'toNo': col(r, '派生先ーアクティビティ・アウトプット・アウトカムの番号'),
            'toKind': dst_kind,
            'to': col(r, '派生先ー 活動目標／成果目標')[:80],
            'toNextOutcome': col(r, '後続アウトカムへのつながり')[:80],
        })
        reason = col(r, 'アウトカムを複数段階で設定できない理由')
        if reason and not out[pid]['noMultiStageReason']:
            out[pid]['noMultiStageReason'] = reason[:200]

    # つながりの型を集計（活動→成果まで一本で通っているかを機械的に判定できるようにする）
    for pid, d in out.items():
        kinds = defaultdict(int)
        for l in d['links']:
            kinds[f"{l['fromKind']}→{l['toKind']}"] += 1
        d['counts'] = {
            'total': len(d['links']),
            'byPath': dict(kinds),
            'reachesOutcome': sum(1 for l in d['links'] if l['toKind'] == 'アウトカム'),
            'outcomeToOutcome': kinds.get('アウトカム→アウトカム', 0),
        }
    return out


def main():
    print(f'年度: {YEAR} / 入力: {SRC}')
    goals = build_goals(args.recent)
    reviews = build_reviews()
    related = build_related()
    links = build_links()

    pids = set(goals) | set(reviews) | set(related) | set(links)
    result = {}
    for pid in pids:
        g = goals.get(pid, {'indicators': [], 'counts': {}})
        result[pid] = {
            'indicators': g['indicators'],
            'indicatorCounts': g['counts'],
            'review': reviews.get(pid),
            'relatedProjects': related.get(pid, []),
            'logicModel': links.get(pid),
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)

    n_ind = sum(len(v['indicators']) for v in result.values())
    n_actual = sum(v['indicatorCounts'].get('withActual', 0) for v in result.values())
    n_outcome_actual = sum(v['indicatorCounts'].get('outcomeWithActual', 0) for v in result.values())
    n_expert = sum(1 for v in result.values() if (v['review'] or {}).get('expertOpinion'))
    size_mb = OUT.stat().st_size / 1e6
    print(f'  事業数        : {len(result):,}')
    print(f'  指標          : {n_ind:,}（実績値あり {n_actual:,} / うちアウトカム {n_outcome_actual:,}）')
    print(f'  外部有識者所見 : {n_expert:,}事業')
    n_link = sum(1 for v in result.values() if v.get('logicModel'))
    n_reach = sum(1 for v in result.values()
                  if ((v.get('logicModel') or {}).get('counts') or {}).get('reachesOutcome'))
    print(f'  関連事業      : {sum(1 for v in result.values() if v["relatedProjects"]):,}事業')
    print(f'  ロジックモデル : {n_link:,}事業（アウトカムまで到達 {n_reach:,}）')
    print(f'出力: {OUT.name} ({size_mb:.1f}MB)')


if __name__ == '__main__':
    main()
