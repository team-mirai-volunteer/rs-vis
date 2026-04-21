"""
事業別 支出先データ品質スコア計算

5軸評価:
  1. 支出先名の品質 (valid_ratio)       重み 40%
  2. 法人番号の記入率 (cn_fill_ratio)    重み 20%
  3. 予算・支出バランス (gap_ratio)       重み 20%
  4. ブロック構造の妥当性                 重み 10%
  5. 支出先名の透明性（不透明キーワード辞書ベース） 重み 10%

実行:
  python3 scripts/score-project-quality.py [--year YEAR] [--limit N]
  デフォルト: --year 2024

出力:
  data/result/project_quality_scores_{YEAR}.csv
  public/data/project-quality-scores-{YEAR}.json
  public/data/project-quality-recipients-{YEAR}.json
"""

import csv
import json
import re
import unicodedata
import collections
import argparse
from pathlib import Path

# ── CLI引数 ──
parser = argparse.ArgumentParser(description='事業別 支出先データ品質スコア計算')
parser.add_argument('--year', type=int, default=2024, help='対象年度 (例: 2025, デフォルト: 2024)')
parser.add_argument('--limit', type=int, default=0, help='Limit number of projects (0=all)')
args = parser.parse_args()
YEAR = args.year
BUDGET_YEAR = YEAR - 1  # 予算CSVの「予算年度」列でフィルタする値

REPO_ROOT = Path(__file__).parent.parent
BUDGET_CSV = REPO_ROOT / 'data' / f'year_{YEAR}' / f'2-1_RS_{YEAR}_予算・執行_サマリ.csv'
SPEND_CSV  = REPO_ROOT / 'data' / f'year_{YEAR}' / f'5-1_RS_{YEAR}_支出先_支出情報.csv'
BLOCK_CSV  = REPO_ROOT / 'data' / f'year_{YEAR}' / f'5-2_RS_{YEAR}_支出先_支出ブロックのつながり.csv'
DICT_CSV   = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'recipient_dictionary.csv'
GOV_CSV    = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'government_agency_names.csv'
SUPP_CSV   = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'supplementary_valid_names.csv'
OPAQUE_CSV = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'opaque_recipient_keywords.csv'
OUT_CSV              = REPO_ROOT / 'data' / 'result' / f'project_quality_scores_{YEAR}.csv'
OUT_JSON             = REPO_ROOT / 'public' / 'data' / f'project-quality-scores-{YEAR}.json'
OUT_RECIPIENTS_JSON  = REPO_ROOT / 'public' / 'data' / f'project-quality-recipients-{YEAR}.json'

def to_int(s):
    try:    return int(str(s).replace(',', '').strip())
    except: return 0

def to_int_or_none(s):
    """空欄はNone、'0'は0、それ以外は整数を返す（表示上の区別用）"""
    stripped = str(s).replace(',', '').strip()
    if not stripped:
        return None
    try:    return int(stripped)
    except: return None

def normalize(s):
    return unicodedata.normalize('NFKC', s)

# ── 1. 辞書ロード ──
print('辞書ロード中...')
dict_map = {}
with open(DICT_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        dict_map[r['name']] = r['valid'] == 'True'

# 行政機関辞書ロード（厳密辞書invalidの中から行政機関として確認済みの名称を救済）
gov_agency_map = {}  # name -> agency_type
with open(GOV_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        gov_agency_map[r['name']] = r['agency_type']
print(f'  行政機関辞書: {len(gov_agency_map):,}件')

# 補助辞書ロード（厳密辞書invalidの中から実在確認済みの名称を救済 / 大学名改組等）
supp_map = {}  # name -> category
with open(SUPP_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        supp_map[r['name']] = r['category']
print(f'  補助辞書: {len(supp_map):,}件')

# 不透明支出先名キーワード辞書ロード
opaque_rules = []  # list of (match_type, pattern, level, compiled_regex_or_None)
with open(OPAQUE_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        mt = r['match_type'].strip()
        pat = r['pattern'].strip()
        level = int(r['level'].strip())
        compiled = re.compile(pat) if mt == 'regex' else None
        opaque_rules.append((mt, pat, level, compiled))
print(f'  不透明キーワード辞書: {len(opaque_rules)}ルール')

def is_opaque_name(name: str) -> int:
    """不透明な支出先名か判定。マッチしたらlevel(1-3)を返す、マッチしなければ0"""
    for mt, pat, level, compiled in opaque_rules:
        if mt == 'exact' and name == pat:
            return level
        elif mt == 'prefix' and name.startswith(pat) and name != pat:
            return level
        elif mt == 'contains' and pat in name and name != pat:
            return level
        elif mt == 'regex' and compiled and compiled.search(name):
            return level
    return 0
print(f'  辞書: {len(dict_map):,}件')

# ── 2. 予算サマリ（予算年度=BUDGET_YEAR, 会計区分=空の合計行） ──
print('予算サマリ ロード中...')
exec_by_pid = {}    # pid -> exec_amount
budget_by_pid = {}  # pid -> budget_amount (歳出予算現額合計)
with open(BUDGET_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        if r['予算年度'] == str(BUDGET_YEAR) and r['会計区分'].strip() == '':
            pid = r['予算事業ID']
            exec_by_pid[pid] = to_int(r['執行額(合計)'])
            budget_by_pid[pid] = to_int(r['計(歳出予算現額合計)'])
print(f'  予算年度{BUDGET_YEAR}合計行: {len(exec_by_pid):,}事業')

# ── 3. ブロック接続グラフ（5-2 CSV）から再委託深度を算出 ──
print('ブロック接続グラフ ロード中...')
# pid -> list of (src_block, dst_block, from_org:bool)
block_links_by_pid = collections.defaultdict(list)
with open(BLOCK_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID'].strip()
        src_block = r['支出元の支出先ブロック'].strip()
        dst_block = r['支出先の支出先ブロック'].strip()
        from_org = r['担当組織からの支出'].strip().upper() == 'TRUE'
        block_links_by_pid[pid].append((src_block, dst_block, from_org))

def calc_redelegation_depth(pid_links):
    """BFSでルート（担当組織からの支出=TRUE）からの最大深度を算出"""
    children = collections.defaultdict(list)
    roots = set()
    for src, dst, from_org in pid_links:
        if from_org:
            roots.add(dst)
        else:
            children[src].append(dst)
    if not roots:
        return 0
    max_depth = 0
    visited = set()
    queue = collections.deque((r, 0) for r in roots)
    while queue:
        node, depth = queue.popleft()
        if node in visited:
            continue
        visited.add(node)
        max_depth = max(max_depth, depth)
        for child in children.get(node, []):
            queue.append((child, depth + 1))
    return max_depth

redelegation_by_pid = {}
root_blocks_by_pid = {}  # pid -> set of root block letters (e.g. {'A', 'I', 'H'})
for pid, links in block_links_by_pid.items():
    depth = calc_redelegation_depth(links)
    redelegation_by_pid[pid] = depth
    # ルートブロック（担当組織からの直接支出先）を記録
    roots = set()
    for src, dst, from_org in links:
        if from_org:
            roots.add(dst)
    root_blocks_by_pid[pid] = roots

releg_counts = collections.Counter(redelegation_by_pid.values())
print(f'  ブロック接続: {sum(len(v) for v in block_links_by_pid.values()):,}行, {len(block_links_by_pid):,}事業')
print(f'  再委託深度分布: { {k: releg_counts[k] for k in sorted(releg_counts)} }')

# ブロックチェーンパスを計算（per-recipient表示用: "組織→A→B→C"）
block_chain_by_pid = {}
for pid, links in block_links_by_pid.items():
    parent_map = {}  # block -> parent block (None = root/from_org)
    children_map = collections.defaultdict(list)
    for src, dst, from_org in links:
        if from_org:
            # 担当組織からの直接支出 → dst はルートブロック
            if dst not in parent_map:
                parent_map[dst] = None
        else:
            # ブロック間委託: src -> dst
            if dst not in parent_map:
                parent_map[dst] = src
            children_map[src].append(dst)
    chain = {}
    queue = collections.deque()
    for b, parent in parent_map.items():
        if parent is None:
            chain[b] = f'組織→{b}'
            queue.append(b)
    visited = set(chain.keys())
    while queue:
        block = queue.popleft()
        for dst in children_map.get(block, []):
            if dst not in visited:
                visited.add(dst)
                chain[dst] = f'{chain[block]}→{dst}'
                queue.append(dst)
    block_chain_by_pid[pid] = chain

# 5-2に登場するすべてのブロック（source / dest 両方）を記録
blocks_in_5_2_by_pid = collections.defaultdict(set)
for pid, links in block_links_by_pid.items():
    for src, dst, _ in links:
        if src:
            blocks_in_5_2_by_pid[pid].add(src)
        if dst:
            blocks_in_5_2_by_pid[pid].add(dst)

# 5-1のブロック一覧を事前スキャンして「孤立ブロック」（5-2に未記載）を検出
# ※ルートとして補完はしない（リンクが辿れないため根拠がない）
print('5-1の孤立ブロックを検出中...')
orphan_blocks_by_pid = collections.defaultdict(set)  # pid -> set of orphan block_nos
with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID'].strip()
        block_no = r['支出先ブロック番号'].strip()
        if not block_no:
            continue
        # 5-2にエントリがあるPIDで、当該ブロックが5-2に未記載の場合のみ検出
        if pid in blocks_in_5_2_by_pid and block_no not in blocks_in_5_2_by_pid[pid]:
            orphan_blocks_by_pid[pid].add(block_no)
orphan_count = sum(len(v) for v in orphan_blocks_by_pid.values())
print(f'  孤立ブロック: {orphan_count}件 ({len(orphan_blocks_by_pid)}事業)')

# ── 4. 支出先データ ──
print('支出先データ ロード中...')

class ProjectStats:
    __slots__ = [
        'pid', 'name', 'ministry', 'bureau', 'division', 'section', 'office', 'team', 'unit',
        'valid_count', 'gov_agency_count', 'supp_valid_count', 'invalid_count',
        'cn_filled', 'cn_empty',
        'spend_total', 'spend_net_total',
        'block_names', 'has_redelegation', 'redelegation_depth',
        'block_amounts', 'block_roles', 'recipient_amounts_by_block',
        'orphan_block_count',
        'opaque_count', 'opaque_amount', 'total_recipient_amount',
        'row_count',
        'recipient_rows',  # per-recipient detail for recipients JSON
    ]
    def __init__(self, pid, name, ministry, bureau, division, section, office, team, unit):
        self.pid = pid
        self.name = name
        self.ministry = ministry
        self.bureau = bureau
        self.division = division
        self.section = section
        self.office = office
        self.team = team
        self.unit = unit
        self.valid_count = 0
        self.gov_agency_count = 0
        self.supp_valid_count = 0
        self.invalid_count = 0
        self.cn_filled = 0
        self.cn_empty = 0
        self.spend_total = 0
        self.spend_net_total = 0  # ルートブロックのみの実質支出額
        self.block_names = set()
        self.has_redelegation = False
        self.redelegation_depth = 0
        self.block_amounts = {}          # block_no -> block_amount
        self.block_roles = {}            # block_no -> 事業を行う上での役割
        self.recipient_amounts_by_block = collections.defaultdict(int)  # block_no -> sum of recipient amounts
        self.orphan_block_count = 0     # 5-2に未記載の孤立ブロック数
        self.opaque_count = 0           # 不透明キーワードにマッチした支出先行数
        self.opaque_amount = 0          # 不透明行の金額（個別支出額）合計
        self.total_recipient_amount = 0 # 全支出先行の金額（個別支出額）合計
        self.row_count = 0
        self.recipient_rows = []        # per-recipient detail rows

projects = {}  # pid -> ProjectStats

with open(SPEND_CSV, encoding='utf-8') as f:
    for r in csv.DictReader(f):
        pid = r['予算事業ID']
        recipient_name = r['支出先名'].strip()
        block_no = r['支出先ブロック番号'].strip()
        block_name = r['支出先ブロック名'].strip()

        if pid not in projects:
            projects[pid] = ProjectStats(
                pid, r['事業名'], r['府省庁'].strip(),
                r.get('局・庁', '').strip(), r.get('部', '').strip(),
                r.get('課', '').strip(), r.get('室', '').strip(),
                r.get('班', '').strip(), r.get('係', '').strip(),
            )
        ps = projects[pid]

        # ブロックヘッダー行（支出先名が空でブロック名がある）
        if block_name and block_no:
            ps.block_names.add(block_name)
            block_amt = to_int(r.get('ブロックの合計支出額', ''))
            if block_amt:
                ps.block_amounts[block_no] = block_amt
            role = r.get('事業を行う上での役割', '').strip()
            if role and block_no not in ps.block_roles:
                ps.block_roles[block_no] = role
        # 支出先行（支出先名がある）
        if not recipient_name:
            continue

        ps.row_count += 1

        # 軸2: 法人番号記入率
        cn = r.get('法人番号', '').strip()
        if cn:
            ps.cn_filled += 1
        else:
            ps.cn_empty += 1

        # 軸1: 支出先名品質（3層辞書: 厳密 → 行政機関 → 補助）
        # 厳密辞書マッチでもCNなしはinvalid（法人はCNが必須）
        if recipient_name in dict_map:
            if dict_map[recipient_name]:
                if cn:
                    ps.valid_count += 1
                    row_status = 'valid'
                else:
                    ps.invalid_count += 1
                    row_status = 'invalid'
            elif recipient_name in gov_agency_map:
                ps.gov_agency_count += 1
                row_status = 'gov'
            elif recipient_name in supp_map:
                ps.supp_valid_count += 1
                row_status = 'supp'
            else:
                ps.invalid_count += 1
                row_status = 'invalid'
        else:
            row_status = 'unknown'

        # 金額（支出先の合計支出額 / 金額 を別々に収集）
        amt = to_int(r.get('支出先の合計支出額', ''))   # 支出先の合計支出額
        amt2 = to_int(r.get('金額', ''))                # 個別支出額
        if amt:
            ps.spend_total += amt
            if block_no:
                ps.recipient_amounts_by_block[block_no] += amt
                # ルートブロックのみ実質支出額に加算（再委託先は二重計上なので除外）
                roots = root_blocks_by_pid.get(pid, set())
                if block_no in roots:
                    ps.spend_net_total += amt

        # 軸5: 不透明支出先名キーワード判定
        opaque = is_opaque_name(recipient_name) > 0
        if amt2:
            ps.total_recipient_amount += amt2
        if opaque:
            ps.opaque_count += 1
            if amt2:
                ps.opaque_amount += amt2

        # per-recipient行を収集（支出先合計行は除外、金額行のみ）
        # 支出先合計行（支出先の合計支出額あり・金額なし）は常に金額行とペアで存在するため除外可能
        # フィールド名は短縮形: n=name, b=blockNo, s=status, c=cnFilled, o=opaque
        # a2=金額（個別支出額、None=空欄,0=明示的ゼロ）
        # role=事業を行う上での役割（ブロック単位）, cc=契約概要
        has_total = bool(r.get('支出先の合計支出額', '').strip())
        has_amt   = bool(r.get('金額', '').strip())
        if has_total and not has_amt:
            continue  # 支出先合計行はスキップ
        ps.recipient_rows.append({
            'n': recipient_name,
            'b': block_no,
            's': row_status,
            'c': bool(cn),
            'o': opaque,
            'a2': to_int_or_none(r.get('金額', '')),
            'role': ps.block_roles.get(block_no, ''),
            'cc': r.get('契約概要', '').strip(),
        })

print(f'  事業数: {len(projects):,}')

# 5-2グラフから再委託情報・孤立ブロック情報をProjectStatsに反映
for pid, ps in projects.items():
    depth = redelegation_by_pid.get(pid, 0)
    if depth > 0:
        ps.has_redelegation = True
        ps.redelegation_depth = depth
    # 5-2データがない事業はルートブロック情報なし → 全額を実質支出とみなす
    if pid not in root_blocks_by_pid:
        ps.spend_net_total = ps.spend_total
    # 孤立ブロック数を反映
    ps.orphan_block_count = len(orphan_blocks_by_pid.get(pid, set()))

# recipient_rows に isRoot フィールドを付与
# （root_blocks_by_pid は5-2グラフから確定済み）
for pid, ps in projects.items():
    roots = root_blocks_by_pid.get(pid, set())
    has_block_data = pid in root_blocks_by_pid
    for row in ps.recipient_rows:
        chain_map = block_chain_by_pid.get(pid, {})
        if has_block_data:
            row['r'] = row['b'] in roots
            c = chain_map.get(row['b'], row['b'])
            row['chain'] = c
            row['d'] = c.count('→') - 1 if c.startswith('組織→') else 0
        else:
            # 5-2データがない事業は全行をルート扱い（spend_net_total = spend_total と同じ扱い）
            row['r'] = True
            row['chain'] = row['b']
            row['d'] = 0

# ── 5. スコア計算 ──
# (section numbers: 1=dict, 2=budget, 3=block-graph, 4=spending, 5=scores)
print('スコア計算中...')

def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))

def calc_scores(ps):
    scores = {}

    # 軸1: 支出先名品質 (0-100)
    # valid = 厳密辞書valid, gov_agency = 行政機関辞書で救済, supp_valid = 補助辞書で救済
    # invalid = いずれの辞書にも存在しない
    dict_total = ps.valid_count + ps.gov_agency_count + ps.supp_valid_count + ps.invalid_count
    if dict_total > 0:
        scores['valid_ratio'] = (ps.valid_count + ps.gov_agency_count + ps.supp_valid_count) / dict_total
        scores['axis1'] = clamp(scores['valid_ratio'] * 100)
    else:
        scores['valid_ratio'] = None
        scores['axis1'] = None  # 辞書突合対象がない場合はスコアなし

    # 軸2: 法人番号記入率 (0-100)
    cn_total = ps.cn_filled + ps.cn_empty
    if cn_total > 0:
        scores['cn_fill_ratio'] = ps.cn_filled / cn_total
        scores['axis2'] = clamp(scores['cn_fill_ratio'] * 100)
    else:
        scores['cn_fill_ratio'] = None
        scores['axis2'] = None

    # 軸3: 予算・支出バランス (0-100)
    # 執行額に対する実質支出合計の乖離で評価
    exec_amt = exec_by_pid.get(ps.pid, 0)
    budget_amt = budget_by_pid.get(ps.pid, 0)
    scores['budget_amount'] = budget_amt
    scores['exec_amount'] = exec_amt
    scores['spend_total'] = ps.spend_total
    scores['spend_net_total'] = ps.spend_net_total
    if exec_amt > 0:
        gap = abs(exec_amt - ps.spend_net_total) / exec_amt
        scores['gap_ratio'] = gap
        # gap=0 → 100点, gap>=1 → 0点（線形）
        scores['axis3'] = clamp((1 - gap) * 100)
    elif ps.spend_net_total == 0:
        scores['gap_ratio'] = 0
        scores['axis3'] = 100  # 両方ゼロは整合
    else:
        scores['gap_ratio'] = None
        scores['axis3'] = None

    # 軸4: ブロック構造 (0-100)
    # 基礎点100から減点方式:
    #   - 再委託深度1: -10
    #   - 再委託深度2: -20
    #   - 再委託深度3: -30
    #   - 再委託深度4+: -40
    #   - ブロック合計と支出先合計の不整合: -30 (1つ以上のブロックで20%超の乖離)
    axis4 = 100
    if ps.has_redelegation:
        axis4 -= min(40, ps.redelegation_depth * 10)

    # ブロック内整合性チェック
    block_inconsistent = 0
    for bno, bamt in ps.block_amounts.items():
        ramt = ps.recipient_amounts_by_block.get(bno, 0)
        if bamt > 0 and abs(bamt - ramt) / bamt > 0.2:
            block_inconsistent += 1
    if block_inconsistent > 0:
        axis4 -= min(30, block_inconsistent * 10)

    scores['axis4'] = clamp(axis4)
    scores['block_count'] = len(ps.block_names)
    scores['has_redelegation'] = ps.has_redelegation
    scores['redelegation_depth'] = ps.redelegation_depth

    # 軸5: 支出先名の透明性 (0-100)
    # 不透明キーワード辞書にマッチする支出先への支出額の割合で評価（金額ベース）
    # 金額データがない場合は件数ベースにフォールバック
    if ps.total_recipient_amount > 0:
        opaque_ratio = ps.opaque_amount / ps.total_recipient_amount
    elif ps.row_count > 0:
        opaque_ratio = ps.opaque_count / ps.row_count
    else:
        opaque_ratio = 0
    scores['opaque_ratio'] = opaque_ratio
    # ratio=0 → 100点, ratio>=0.5 → 0点（線形）
    scores['axis5'] = clamp((1 - opaque_ratio / 0.5) * 100)

    # 総合スコア（重み付き平均、Noneの軸は除外して再配分）
    weights = [
        ('axis1', 40),
        ('axis2', 20),
        ('axis3', 20),
        ('axis4', 10),
        ('axis5', 10),
    ]
    total_weight = 0
    weighted_sum = 0
    for axis_key, w in weights:
        v = scores.get(axis_key)
        if v is not None:
            weighted_sum += v * w
            total_weight += w

    if total_weight > 0:
        scores['total_score'] = round(weighted_sum / total_weight, 1)
    else:
        scores['total_score'] = None

    return scores

# ── 5. CSV出力 ──
fieldnames = [
    '予算事業ID', '事業名', '府省庁', '局・庁', '部', '課', '室', '班', '係',
    '支出先行数', 'valid数', '行政機関辞書valid数', '補助辞書valid数', 'invalid数', 'valid率',
    'CN記入数', 'CN未記入数', 'CN記入率',
    '予算額', '執行額', '支出先合計額', '実質支出額', '乖離率',
    'ブロック数', '再委託有無', '再委託階層',
    '不透明支出先率',
    '軸1_支出先名品質', '軸2_法人番号記入率', '軸3_予算支出バランス',
    '軸4_ブロック構造', '軸5_透明性',
    '総合スコア',
]

def fmt_pct(v):
    if v is None: return ''
    return f'{v*100:.1f}%'

def fmt_score(v):
    if v is None: return ''
    return f'{v:.1f}'

# Sort by PID
sorted_pids = sorted(projects.keys(), key=lambda x: to_int(x))

if args.limit > 0:
    sorted_pids = sorted_pids[:args.limit]
    print(f'  --limit {args.limit}: 先頭{args.limit}事業のみ処理')

results = []
for pid in sorted_pids:
    ps = projects[pid]
    sc = calc_scores(ps)
    results.append({
        '予算事業ID': ps.pid,
        '事業名': ps.name,
        '府省庁': ps.ministry,
        '局・庁': ps.bureau,
        '部': ps.division,
        '課': ps.section,
        '室': ps.office,
        '班': ps.team,
        '係': ps.unit,
        '支出先行数': ps.row_count,
        'valid数': ps.valid_count,
        '行政機関辞書valid数': ps.gov_agency_count,
        '補助辞書valid数': ps.supp_valid_count,
        'invalid数': ps.invalid_count,
        'valid率': fmt_pct(sc['valid_ratio']),
        'CN記入数': ps.cn_filled,
        'CN未記入数': ps.cn_empty,
        'CN記入率': fmt_pct(sc['cn_fill_ratio']),
        '予算額': sc['budget_amount'],
        '執行額': sc['exec_amount'],
        '支出先合計額': sc['spend_total'],
        '実質支出額': sc['spend_net_total'],
        '乖離率': fmt_pct(sc['gap_ratio']),
        'ブロック数': sc['block_count'],
        '再委託有無': 'あり' if sc['has_redelegation'] else 'なし',
        '再委託階層': sc['redelegation_depth'],
        '不透明支出先率': fmt_pct(sc['opaque_ratio']),
        '軸1_支出先名品質': fmt_score(sc['axis1']),
        '軸2_法人番号記入率': fmt_score(sc['axis2']),
        '軸3_予算支出バランス': fmt_score(sc['axis3']),
        '軸4_ブロック構造': fmt_score(sc['axis4']),
        '軸5_透明性': fmt_score(sc['axis5']),
        '総合スコア': fmt_score(sc['total_score']),
    })

with open(OUT_CSV, 'w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(results)

# ── JSON出力（UI用） ──
json_items = []
for pid in sorted_pids:
    ps = projects[pid]
    sc = calc_scores(ps)
    json_items.append({
        'pid': ps.pid,
        'name': ps.name,
        'ministry': ps.ministry,
        'bureau': ps.bureau,
        'division': ps.division,
        'section': ps.section,
        'office': ps.office,
        'team': ps.team,
        'unit': ps.unit,
        'rowCount': ps.row_count,
        'recipientCount': len(ps.recipient_rows),
        'validCount': ps.valid_count,
        'govAgencyCount': ps.gov_agency_count,
        'suppValidCount': ps.supp_valid_count,
        'invalidCount': ps.invalid_count,
        'validRatio': sc['valid_ratio'],
        'cnFilled': ps.cn_filled,
        'cnEmpty': ps.cn_empty,
        'cnFillRatio': sc['cn_fill_ratio'],
        'budgetAmount': sc['budget_amount'],
        'execAmount': sc['exec_amount'],
        'spendTotal': sc['spend_total'],
        'spendNetTotal': sc['spend_net_total'],
        'gapRatio': sc['gap_ratio'],
        'blockCount': sc['block_count'],
        'orphanBlockCount': ps.orphan_block_count,
        'hasRedelegation': sc['has_redelegation'],
        'redelegationDepth': sc['redelegation_depth'],
        'opaqueRatio': sc.get('opaque_ratio', 0),
        'axis1': sc['axis1'],
        'axis2': sc['axis2'],
        'axis3': sc['axis3'],
        'axis4': sc['axis4'],
        'axis5': sc['axis5'],
        'totalScore': sc['total_score'],
    })

with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(json_items, f, ensure_ascii=False)

# ── recipients JSON出力（支出先ごとの詳細行、ダイアログ用）──
recipients_by_pid = {pid: projects[pid].recipient_rows for pid in sorted_pids}
with open(OUT_RECIPIENTS_JSON, 'w', encoding='utf-8') as f:
    json.dump(recipients_by_pid, f, ensure_ascii=False)

print(f'\n出力: {OUT_CSV}')
print(f'  JSON: {OUT_JSON} ({len(json_items):,}件, {OUT_JSON.stat().st_size / 1024:.0f}KB)')
print(f'  事業数: {len(results):,}')

# ── サマリー表示 ──
scored = [r for r in results if r['総合スコア']]
if scored:
    scores_list = [float(r['総合スコア']) for r in scored]
    avg = sum(scores_list) / len(scores_list)
    print(f'  平均スコア: {avg:.1f}')
    print(f'  最高: {max(scores_list):.1f}  最低: {min(scores_list):.1f}')

    # スコア分布
    bins = [(90, 100), (80, 89.9), (70, 79.9), (60, 69.9), (50, 59.9), (0, 49.9)]
    print('\n  スコア分布:')
    for lo, hi in bins:
        cnt = sum(1 for s in scores_list if lo <= s <= hi)
        bar = '#' * (cnt * 40 // len(scores_list)) if scores_list else ''
        print(f'    {lo:>3.0f}-{hi:>5.1f}: {cnt:>5,}件  {bar}')

    # 下位10事業
    print(f'\n  総合スコア 下位10事業:')
    bottom = sorted(scored, key=lambda r: float(r['総合スコア']))[:10]
    print(f'    {"PID":>5} {"スコア":>6} {"府省庁":<18} {"事業名"}')
    for r in bottom:
        print(f'    {r["予算事業ID"]:>5} {r["総合スコア"]:>6} {r["府省庁"]:<18} {r["事業名"][:40]}')

    # 上位10事業
    print(f'\n  総合スコア 上位10事業:')
    top = sorted(scored, key=lambda r: float(r['総合スコア']), reverse=True)[:10]
    print(f'    {"PID":>5} {"スコア":>6} {"府省庁":<18} {"事業名"}')
    for r in top:
        print(f'    {r["予算事業ID"]:>5} {r["総合スコア"]:>6} {r["府省庁"]:<18} {r["事業名"][:40]}')
