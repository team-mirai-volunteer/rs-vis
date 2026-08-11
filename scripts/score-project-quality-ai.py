"""
事業別 支出先データ品質スコア — AI評価フェーズ（最終スコアラ）

設計: docs/quality-scoring-guide.md

スコア軸:
  A. 支出先の特定可能性          (AI判定)   重み 28%
  B. 使途の説明性                (AI判定)   重み 22%
  C. 収支の整合性                (機械計算) 重み 15%
  E. 有効性／成果設計の明確さ    (AI判定)   重み 35%  ※0-10の11段階・実測成果でなく意図ベース
  D. 構造の整合性                (機械計算) 参考表示のみ（総合に不算入）

入力:
  public/data/project-quality-recipients-{year}.json(.gz)  per-recipient文脈（AI判定対象）
  public/data/project-quality-scores-{year}.json           機械signal（収支C・構造Dの素材）

出力:
  public/data/project-quality-scores-{year}.json           新スキーマで上書き（UI表示用）

実行:
  python3 scripts/score-project-quality-ai.py [--year 2025] [--model google/gemini-3.5-flash]
                                              [--no-gate] [--limit N]

  AI判定は OpenRouter（OpenAI互換API）経由。OPENROUTER_API_KEY が未設定なら
  決定的ヒューリスティックで全行を採点し aiSource="heuristic" を付与する
  （パイプラインを常に完走させ、ローカル検証可能にする）。本番は aiSource="openrouter:<model>"。

  本番の大量判定は flash 系がコスト効率的:
    OPENROUTER_API_KEY=... python3 scripts/score-project-quality-ai.py --year 2025 --model google/gemini-3.5-flash

  ※ キャッシュ名はモデル末尾セグメントで正規化するため、同一実モデルなら
     プロバイダを跨いでも（例: 直Gemini→OpenRouter経由）既存キャッシュを再利用する。

  依存: pip install openai
"""

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# ── CLI ──
parser = argparse.ArgumentParser(description='支出先データ品質スコア AI評価フェーズ')
parser.add_argument('--year', type=int, default=2025, help='対象年度 (デフォルト: 2025)')
parser.add_argument('--model', default='google/gemini-3.5-flash',
                    help='OpenRouterモデル (デフォルト: google/gemini-3.5-flash。例: anthropic/claude-haiku-4-5, openai/gpt-4o-mini)')
parser.add_argument('--base-url', default='https://openrouter.ai/api/v1',
                    help='OpenAI互換APIのベースURL (デフォルト: OpenRouter)')
parser.add_argument('--no-gate', action='store_true',
                    help='ゲーティングを無効化し全ユニークタプルをAI判定（コスト増・最も網羅的）')
parser.add_argument('--batch', action='store_true',
                    help='（互換用フラグ。OpenRouterでは同期チャンク呼び出しにフォールバック）')
parser.add_argument('--batch-size', type=int, default=20,
                    help='1リクエストあたりの判定件数 (デフォルト20)')
parser.add_argument('--concurrency', type=int, default=6,
                    help='並列API呼び出し数 (デフォルト6。レート制限が出る場合は下げる)')
parser.add_argument('--limit', type=int, default=0, help='先頭N事業のみ処理 (0=全件)')
parser.add_argument('--dump-prompt', action='store_true',
                    help='APIを呼ばずに、組み立てたシステムプロンプトと1チャンク分のユーザープロンプトを出力する')
parser.add_argument('--benchmark', action='store_true',
                    help='ベンチマークセット（tests/fixtures/quality-evaluation-benchmark-30.json）だけを'
                         '本番と同じコードパスで評価し、tests/benchmark-results/ に出力する。'
                         '本番データ(project-quality-scores)は上書きしない')
parser.add_argument('--votes', type=int, default=1,
                    help='政策評価を同一入力でN回採点し軸ごとに平均する（測定ノイズを1/√Nに落とす）。'
                         'デフォルト1。1票目は従来のキャッシュキーと同一なので既存の走行結果を流用できる。'
                         '実測では1票だと推奨判断の再現率が81.7%%しかない（3票で約89%%）')
parser.add_argument('--force', action='store_true', help='キャッシュを無視して再判定')
args = parser.parse_args()

YEAR = args.year
MODEL = args.model
GATE = not args.no_gate
CONCURRENCY = max(1, args.concurrency)

REPO_ROOT = Path(__file__).parent.parent
RECIPIENTS_JSON     = REPO_ROOT / 'public' / 'data' / f'project-quality-recipients-{YEAR}.json'
RECIPIENTS_JSON_GZ  = REPO_ROOT / 'public' / 'data' / f'project-quality-recipients-{YEAR}.json.gz'
SCORES_JSON         = REPO_ROOT / 'public' / 'data' / f'project-quality-scores-{YEAR}.json'
PRIOR_SCORES_JSON   = REPO_ROOT / 'public' / 'data' / f'project-quality-scores-{int(YEAR) - 1}.json'
PRIOR_SCORES_GZ     = REPO_ROOT / 'public' / 'data' / f'project-quality-scores-{int(YEAR) - 1}.json.gz'
DETAILS_JSON        = REPO_ROOT / 'public' / 'data' / f'rs{YEAR}-project-details.json'
OUTCOMES_JSON       = REPO_ROOT / 'public' / 'data' / f'rs{YEAR}-project-outcomes.json'
OUTCOMES_JSON_GZ    = REPO_ROOT / 'public' / 'data' / f'rs{YEAR}-project-outcomes.json.gz'
DETAILS_JSON_GZ     = REPO_ROOT / 'public' / 'data' / f'rs{YEAR}-project-details.json.gz'
OPAQUE_CSV          = REPO_ROOT / 'public' / 'data' / 'dictionaries' / 'opaque_recipient_keywords.csv'
CACHE_DIR           = REPO_ROOT / 'data' / 'cache'
# キャッシュ名はモデル末尾セグメントで正規化（プロバイダ跨ぎで同一実モデルなら再利用）。
# 例: 'google/gemini-2.5-flash' / 'gemini-2.5-flash' → どちらも 'gemini-2.5-flash'
MODEL_SLUG          = re.sub(r'[^A-Za-z0-9._-]', '-', MODEL.split('/')[-1])
CACHE_FILE          = CACHE_DIR / f'ai-quality-cache-{MODEL_SLUG}.json'

# ── 新軸の重み（5軸: 透明性4軸＋有効性1軸） ──
# 軸D（構造の整合性）は平均99.9でほぼ弁別しないため総合から除外し、参考表示のみ（axisStructureは引き続き算出）。
WEIGHTS = [
    ('axisIdentify', 28),   # A 特定可能性（AI）
    ('axisPurpose', 22),    # B 使途の説明性（AI）
    ('axisBudget', 15),     # C 収支の整合性（機械）
    ('axisEffective', 35),  # E 有効性／成果設計の明確さ（AI・意図ベース）
]

# レベル(0-3) → 点数
LEVEL_TO_SCORE = {0: 0.0, 1: 40.0, 2: 70.0, 3: 100.0}

# 収支整合性の許容バンド（この乖離までは満点）
BUDGET_TOLERANCE = 0.10


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def normalize(s):
    return unicodedata.normalize('NFKC', s or '')


def load_json_maybe_gz(plain: Path, gz: Path):
    if plain.exists():
        with open(plain, encoding='utf-8') as f:
            return json.load(f)
    if gz.exists():
        with gzip.open(gz, 'rt', encoding='utf-8') as f:
            return json.load(f)
    raise FileNotFoundError(
        f'{plain.name} が見つかりません。先に '
        f'python3 scripts/score-project-quality.py --year {YEAR} を実行してください。'
    )


# ── 不透明キーワード辞書 ──
def load_opaque_rules():
    rules = []
    if not OPAQUE_CSV.exists():
        return rules
    import csv
    with open(OPAQUE_CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            mt = r['match_type'].strip()
            pat = r['pattern'].strip()
            level = int(r['level'].strip())
            compiled = re.compile(pat) if mt == 'regex' else None
            rules.append((mt, pat, level, compiled))
    return rules


OPAQUE_RULES = load_opaque_rules()


def is_opaque_name(name: str) -> bool:
    for mt, pat, level, compiled in OPAQUE_RULES:
        if mt == 'exact' and name == pat:
            return True
        if mt == 'prefix' and name.startswith(pat) and name != pat:
            return True
        if mt == 'contains' and pat in name and name != pat:
            return True
        if mt == 'regex' and compiled and compiled.search(name):
            return True
    return False


# ── 判定タプルのキー ──
def tuple_key(row):
    """同一(name, cc, role, cn有無, status)は1回だけ判定する"""
    raw = '|'.join([
        normalize(row.get('n', '')),
        normalize(row.get('cc', '')),
        normalize(row.get('role', '')),
        '1' if row.get('c') else '0',
        row.get('s', ''),
    ])
    return hashlib.sha1(raw.encode('utf-8')).hexdigest()


# ── 決定的ヒューリスティック判定（APIキー無し時のフォールバック） ──
_GENERIC_CC = re.compile(r'^(業務委託|委託業務|請負|物品購入|役務|その他|一式|—|-|不明)?$')


def heuristic_judge(row):
    name = normalize(row.get('n', ''))
    cc = normalize(row.get('cc', '')).strip()
    role = normalize(row.get('role', '')).strip()
    status = row.get('s', '')
    has_cn = bool(row.get('c'))
    opaque = bool(row.get('o')) or is_opaque_name(name)

    # identifiability
    if opaque:
        identify = 0
    elif status == 'valid' and has_cn:
        identify = 3
    elif status in ('gov', 'supp'):
        identify = 2
    elif status == 'valid':  # 名称一致だがCN欠落
        identify = 2
    elif status == 'invalid':
        identify = 1
    else:  # unknown（辞書未登録）— 文脈があれば中間評価
        identify = 2 if (len(cc) >= 12 or len(role) >= 8) else 1

    # purpose（契約概要・役割の具体性）
    text = cc if len(cc) >= len(role) else role
    if not text or _GENERIC_CC.match(text):
        purpose = 0
    elif len(text) < 8:
        purpose = 1
    elif len(text) < 20:
        purpose = 2
    else:
        purpose = 3

    return {'identify': identify, 'purpose': purpose, 'reason': 'heuristic'}


# ── OpenRouter(OpenAI互換)判定 ──
_JSON_INSTRUCT = '\n\n必ず次の形式の有効なJSONのみを返してください（前後に説明文を付けない）:\n'


def make_client():
    from openai import OpenAI  # pip install openai
    key = os.environ.get('OPENROUTER_API_KEY')
    return OpenAI(
        base_url=args.base_url,
        api_key=key,
        default_headers={'HTTP-Referer': 'https://github.com/rs-vis', 'X-Title': 'rs-vis quality scoring'},
    )


# フェーズ別のAPI使用量。支出先判定は全件で重複排除が効くため、
# ベンチマーク30件の実績をそのまま全件へ比例換算してはいけない。政策評価とは分けて集計する。
USAGE_BY_PHASE = {}
_USAGE_PHASE = 'other'


def set_usage_phase(name):
    global _USAGE_PHASE
    _USAGE_PHASE = name


def _record_usage(u):
    d = USAGE_BY_PHASE.setdefault(_USAGE_PHASE,
                                  {'prompt_tokens': 0, 'completion_tokens': 0, 'cost': 0.0, 'calls': 0})
    if u is not None:
        d['prompt_tokens'] += getattr(u, 'prompt_tokens', 0) or 0
        d['completion_tokens'] += getattr(u, 'completion_tokens', 0) or 0
        d['cost'] += float(getattr(u, 'cost', 0) or 0)
    d['calls'] += 1


def llm_json(client, model, system, prompt):
    """OpenRouter(OpenAI互換)で JSON を生成して dict にパース。"""
    resp = client.chat.completions.create(
        model=model,
        messages=[{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
        temperature=0,
        max_tokens=8192,
        response_format={'type': 'json_object'},
        # 分類タスクなので推論(thinking)は最小限に（一部モデルは無効化不可のため effort=low）
        extra_body={'reasoning': {'effort': 'low'}},
    )
    _record_usage(getattr(resp, 'usage', None))
    return _loads_lenient(resp.choices[0].message.content or '')


# results配列の各要素はフラットな{...}（ネスト無し）。
# モデルが稀に末尾切れ・末尾カンマ・コードフェンス付きの不正JSONを返すため、
# まず厳密パース→失敗時は個別の{...}を正規表現で救出し、取れた要素だけ返す。
_OBJ_RE = re.compile(r'\{[^{}]*\}')


def _loads_lenient(text):
    text = (text or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```[a-zA-Z]*', '', text).strip()
        if text.endswith('```'):
            text = text[:-3].strip()
    if '{' in text:
        text = text[text.find('{'):]
    try:
        return json.loads(text)
    except Exception:
        pass
    # 救出: 完全な{...}要素だけを個別パースして results に詰め直す
    objs = []
    for m in _OBJ_RE.finditer(text):
        try:
            objs.append(json.loads(m.group(0)))
        except Exception:
            continue
    return {"results": objs}


JUDGE_SYSTEM = (
    "あなたは日本の行政事業レビュー（公開支出データ）の品質監査官です。"
    "各支出先の記載について、納税者が『誰にいくら何のために払ったか』を追跡・検証できるかを評価します。\n\n"
    "【identifiability（特定可能性 0-3）】支出先が具体的に誰で、第三者が実在を確認できるか。\n"
    " 0=特定不能（その他/未定/非公開/個人/プレースホルダ等）\n"
    " 1=曖昧（辞書未登録で文脈も薄く実体が不明）\n"
    " 2=ほぼ特定可（国の出先機関・自治体・改組大学・海外団体など、CIなしでも文脈で実体が明確）\n"
    " 3=完全特定可（正式法人名＋法人番号、または公的機関の正式名称）\n\n"
    "【purpose（使途の説明性 0-3）】役割・契約概要から何にいくら使ったかが理解・検証できるか。\n"
    " 0=記載なし\n 1=定型句・抽象的（『業務委託』『一式』等のみ）\n"
    " 2=概ね具体的\n 3=具体的で検証可能（対象・内容が明確）\n\n"
    "個人・外国法人・国の機関は法人番号を持たないことがあり、CN欠落のみを理由に不当に下げないこと。"
)

def _clamp_lvl(v, hi=3):
    try:
        return max(0, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return 1


def _build_user_prompt(items):
    lines = ["次の支出先を評価してください。\n"]
    for idx, it in enumerate(items):
        lines.append(
            f"[{idx}] 名称: {it['n'] or '(空)'} / 法人番号: {'あり' if it['c'] else 'なし'} / "
            f"辞書判定: {it['s']} / 役割: {it.get('role') or '(空)'} / "
            f"契約概要: {it.get('cc') or '(空)'}"
        )
    lines.append(_JSON_INSTRUCT +
                 '{"results":[{"i":<index>,"identify":<0-3>,"purpose":<0-3>,"reason":"<20字以内>"}, ...]}')
    return "\n".join(lines)


def judge_chunk(client, items, model):
    """items(<=batch_size) を1リクエストで判定。index対応のdictを返す。"""
    data = llm_json(client, model, JUDGE_SYSTEM, _build_user_prompt(items))
    out = {}
    for r in data.get("results", []):
        out[int(r["i"])] = {"identify": _clamp_lvl(r.get("identify")),
                            "purpose": _clamp_lvl(r.get("purpose")),
                            "reason": r.get("reason", "")}
    return out


def _flush_cache(cache, cache_path):
    if cache is not None and cache_path is not None:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False)


def _run_batches(client, uniques, model, bs, chunk_fn, fill_fn, label,
                 cache=None, cache_path=None):
    """uniquesをbs件ずつのチャンクに分け、CONCURRENCY並列でchunk_fnを実行。
    実AI成功分は cache に保存し定期フラッシュ（中断耐性）。{key: judgment} を返す。"""
    keys = [k for k, _ in uniques]
    items = [it for _, it in uniques]
    n = len(items)
    batches = [(s, items[s:s + bs], keys[s:s + bs]) for s in range(0, n, bs)]

    def work(b):
        start, chunk, _ = b
        for attempt in range(4):
            try:
                return b, chunk_fn(client, chunk, model)
            except Exception as e:
                if attempt == 3:
                    print(f'\n  [warn] {label}失敗 (start={start}): {e} → ヒューリスティック補完')
                    return b, {}
                time.sleep(2 ** attempt)

    results = {}
    done = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        # map はチャンクを並列実行しつつ入力順に結果を返す（cache更新はこのスレッドのみ＝安全）
        for b, judged in ex.map(work, batches):
            _, chunk, chunk_keys = b
            for li, key in enumerate(chunk_keys):
                if li in judged:
                    results[key] = judged[li]
                    if cache is not None:
                        cache[key] = judged[li]      # 実AI成功分のみ永続化
                else:
                    results[key] = {**fill_fn(chunk[li]), 'reason': 'heuristic(fill)'}
            done += 1
            if done % 20 == 0:
                _flush_cache(cache, cache_path)
            print(f'\r  {label} {min(done * bs, n):,}/{n:,}', end='', flush=True)
    _flush_cache(cache, cache_path)
    print()
    return results


def judge_uniques_sync(client, uniques, model, batch_size, cache=None, cache_path=None):
    set_usage_phase('recipient')
    """支出先（軸A/B）の判定。"""
    return _run_batches(client, uniques, model, batch_size,
                        judge_chunk, heuristic_judge, 'AI判定', cache, cache_path)


def judge_uniques_batch(client, uniques, model, batch_size, cache=None, cache_path=None):
    """OpenRouter版: 専用Batch APIは未配線。同期（並列）チャンク呼び出しにフォールバック。"""
    return judge_uniques_sync(client, uniques, model, batch_size, cache, cache_path)


# ── ゲーティング: AI判定が要らない明白な行をルールで即決 ──
def gate_judgment(row):
    """ゲートで即決できれば judgment を返す。AI判定が必要なら None。"""
    name = normalize(row.get('n', ''))
    if bool(row.get('o')) or is_opaque_name(name):
        # 不透明: identifyは0で確定。purposeは契約概要から機械判定
        h = heuristic_judge(row)
        return {'identify': 0, 'purpose': h['purpose'], 'reason': 'gate:opaque'}
    return None  # それ以外はAIへ



# ── アンカー定義（段階採点で使用）──
ANCHORS_JSON  = REPO_ROOT / 'tests' / 'fixtures' / 'quality-evaluation-anchors.json'
TAXONOMY_JSON = REPO_ROOT / 'tests' / 'fixtures' / 'policy-taxonomy.json'
BENCHMARK_JSON = REPO_ROOT / 'tests' / 'fixtures' / 'quality-evaluation-benchmark-30.json'
BENCHMARK_OUT = REPO_ROOT / 'tests' / 'benchmark-results'


def load_anchors():
    """4観点のアンカー定義を読む。揃っていなければ None（旧方式にフォールバック）。"""
    if not ANCHORS_JSON.exists():
        return None
    with open(ANCHORS_JSON, encoding='utf-8') as f:
        fx = json.load(f)
    need = ('evidenceAnchors', 'proportionalityAnchors', 'necessityAnchors')
    if not all(fx.get(k) for k in need):
        return None
    return fx


def load_taxonomy():
    if not TAXONOMY_JSON.exists():
        return None
    with open(TAXONOMY_JSON, encoding='utf-8') as f:
        return json.load(f)


def taxonomy_ids(tax):
    return {c['id'] for g in tax['groups'] for c in g['categories']}


def _taxonomy_block(tax):
    out = []
    for g in tax['groups']:
        out.append(f"【{g['label']}】")
        for c in g['categories']:
            out.append(f"  {c['id']} : {c['label']} — {c['desc']}")
    return '\n'.join(out)


def _fmt_oku(v):
    return '—' if v is None else f'{v / 1e8:.1f}億円'


def _fmt_pct(v):
    return '判定不能' if v is None else f'{round(v * 100)}%'


def _fmt_indicators(d):
    """成果指標を採点用に整形する。件数だけでなく実績値・達成率まで見せる。"""
    c = d.get('indicatorCounts') or {}
    inds = d.get('indicators') or []
    if not inds:
        return '登録された成果指標: なし'
    by = c.get('byKind') or {}
    head = (f"登録された成果指標: 計{c.get('total', 0)}件"
            f"（アウトカム{by.get('アウトカム', 0)} / アウトプット{by.get('アウトプット', 0)} / "
            f"アクティビティ{by.get('アクティビティ', 0)}）"
            f" 実績値あり{c.get('withActual', 0)}件・うちアウトカム{c.get('outcomeWithActual', 0)}件"
            f" / 出典明記{c.get('withSource', 0)}件")
    # アウトカム→アウトプット→その他 の順に、実績のあるものを優先して数件見せる
    order = {'アウトカム': 0, 'アウトプット': 1}
    picked = sorted(inds, key=lambda i: (order.get(i.get('kind'), 2), 0 if i.get('latestActual') else 1))[:6]
    body = []
    for i in picked:
        name = (i.get('indicator') or i.get('goal') or '')[:34]
        la, lr = i.get('latestActual'), i.get('latestRate')
        val = f"{la['year']}年 実績{la['value']}{i.get('unit') or ''}" if la else '実績値なし'
        rate = ''
        if lr and lr.get('value') is not None:
            rate = f" 達成率{lr['value']:.0f}%"
        src = f" 出典:{i['source'][:20]}" if i.get('source') else ''
        body.append(f"      [{i.get('kind') or '不明'}] {name} … {val}{rate}{src}")
    return head + '\n' + '\n'.join(body)


def _fmt_logic(d):
    """3-2 のロジックモデル。成果設計が登録データとして接続されているかを示す。"""
    lm = d.get('logicModel') or {}
    links = lm.get('links') or []
    if not links:
        return 'ロジックモデル: 未登録'
    c = lm.get('counts') or {}
    head = ('ロジックモデル: 接続{}本（アウトカムへ到達{}本 / アウトカム間の多段接続{}本）'
            .format(c.get('total', 0), c.get('reachesOutcome', 0), c.get('outcomeToOutcome', 0)))
    body = ['      {}「{}」→ {}「{}」'.format(l['fromKind'], l['from'][:28], l['toKind'], l['to'][:28])
            for l in links[:4]]
    if lm.get('noMultiStageReason'):
        body.append('      多段アウトカムを設定できない理由: ' + lm['noMultiStageReason'][:70])
    return head + chr(10) + chr(10).join(body)


def _fmt_related(d):
    """1-5 関連事業。他事業との統合可能性を判断する材料。"""
    rel = d.get('relatedProjects') or []
    if not rel:
        return '関連事業: 登録なし'
    return '関連事業: ' + ' / '.join(
        '{}（{}）'.format((r.get('name') or '')[:26], (r.get('relation') or '')[:16]) for r in rel[:4])


def _fmt_review(d):
    """点検・評価。外部有識者とレビュー推進チームの所見は独立した証拠として重い。"""
    r = d.get('review') or {}
    if not r:
        return '点検・評価: 記載なし'
    parts = []
    if r.get('selfCheck'):
        parts.append(f"      所管部局の点検結果: {r['selfCheck'][:70]}")
    if r.get('improvementDirection'):
        parts.append(f"      改善の方向性: {r['improvementDirection'][:70]}")
    if r.get('expertOpinion'):
        parts.append(f"      外部有識者の所見: {r['expertOpinion'][:150]}")
    if r.get('teamOpinion'):
        parts.append(f"      レビュー推進チームの所見: {r['teamOpinion'][:120]}")
    if r.get('reflection'):
        parts.append(f"      所見の反映状況: {r['reflection'][:80]}")
    return '点検・評価:\n' + '\n'.join(parts) if parts else '点検・評価: 記載なし'


def _fmt_recipients(d):
    rows = d.get('topRecipients') or []
    if not rows:
        return '（支出先データなし）'
    head = f"支出先{d.get('recipientCount', len(rows))}者中の上位:"
    body = []
    for r in rows:
        amt = '—' if r.get('amount') is None else f"{r['amount'] / 1e8:.2f}億円"
        share = '' if r.get('share') is None else f"({round(r['share'] * 100)}%)"
        chain = f" 委託経路:{r.get('chain', '')}({r.get('depth')}次下請)" if (r.get('depth') or 0) > 0 else ''
        body.append(f"      {r['name']} {amt}{share}{chain} "
                    f"役割:{(r.get('role') or '—')[:40]} 契約:{(r.get('contract') or '—')[:50]}")
    return head + '\n' + '\n'.join(body)


def _anchor_block(title, anchors, detail_by_pid, mode='text'):
    """アンカーには、その軸の判定材料そのものを載せる。

    mode:
      'text'       目的/概要のみ
      'logic'      目的/概要 + ロジックモデル（成果設計の判定材料）
      'indicators' 目的/概要 + 登録指標（検証可能性の判定材料）
      'budget'     予算実績
      'recipients' 予算 + 支出先（費用対内容・必要性の判定材料）
    """
    lines_ = [f'【{title}のアンカー】']
    for a in sorted(anchors, key=lambda x: x['score']):
        head = f"- スコア{a['score']}: {a['label']}"
        pid = a.get('pid')
        if not pid:
            lines_.append(f"{head}\n    判定理由: {a['rationale']}")
            continue
        d = detail_by_pid.get(str(pid), {})
        rows = [head, f"    事業名: {d.get('projectName', '')}"]
        if mode == 'recipients':
            rows.append(f"    予算: {_fmt_oku(d.get('budgetAmount'))}")
            rows.append(f"    {_fmt_recipients(d)}")
        elif mode == 'logic':
            rows.append(f"    目的: {normalize(d.get('purpose') or '')[:160]}")
            rows.append(f"    {_fmt_logic(d)}")
        elif mode == 'indicators':
            rows.append(f"    目的: {normalize(d.get('purpose') or '')[:120]}")
            rows.append(f"    {_fmt_indicators(d)}")
        elif mode == 'budget':
            rows.append(f"    予算/執行: 予算{_fmt_oku(d.get('budgetAmount'))} / "
                        f"執行率{_fmt_pct(d.get('executionRate'))} / 前年度{_fmt_pct(d.get('priorExecutionRate'))}")
        else:
            rows.append(f"    目的: {normalize(d.get('purpose') or '')[:200]}")
            rows.append(f"    概要: {normalize(d.get('overview') or '')[:140]}")
        rows.append(f"    判定理由: {a['rationale']}")
        lines_.append('\n'.join(rows))
    return '\n'.join(lines_)


def build_unified_system(anchors, tax, detail_by_pid):
    """段階採点のシステムプロンプト。ルーブリックの定義はこのファイルが唯一の正。"""
    return (
        'あなたは日本の行政事業レビューの評価官です。提示された事業群を、独立した観点で採点します。\n\n'
        '【最重要】観点ごとに段階を分けて処理すること。\n'
        'まず全事業の分類を終えてから設計に移り、以降も観点ごとに全事業を横断して進めます。\n'
        '1事業ずつまとめて出すのではなく、観点ごとに全事業を横断してください。\n'
        '前の観点の評価を次に持ち込まないこと。観点が変わったら視点をリセットします。\n\n'
        '各観点の中では、提示された事業どうしを相互に比較して差をつけてください。\n'
        '同じ観点で全事業が同じ点に固まるのは採点として失敗です。\n'
        '採点は【アンカー事例】との距離で決めます。「最も近いアンカーを選ぶ → 上か下か → ±1〜2」の順。\n'
        'アンカーと同じ点（0/2/4/6/8/10）に寄せず、中間の 1・3・5・7・9 も積極的に使うこと。\n\n'

        '━━━ 段階0: 政策類型の分類（category）━━━\n'
        '各事業を次の一覧からちょうど1つの id で分類してください。府省庁ではなく政策としての機能で選びます。\n\n'
        + _taxonomy_block(tax) + '\n\n'
        '分類の注意:\n'
        '- 事業名ではなく、実際に何を行う事業かで判断する。\n'
        '- 交付金でも使途が特定分野に限定されるならその分野を選ぶ。広範で特定できない場合のみ grant_admin。\n'
        '- 実態が外部委託による調査・意見聴取・広報であれば、対象分野に関わらず survey_pr を選ぶ。\n'
        '- other は本当にどれにも当てはまらない場合のみ。安易に逃げないこと。\n\n'

        '━━━ 段階1: 成果設計の明確さ（design）━━━\n'
        '誰のどんな課題を、どの活動で、どう改善するかが、どれだけ特定できる形で説明されているか。\n\n'
        '**判定材料は概要文と登録されたロジックモデルの両方。**\n'
        'ロジックモデルは活動→アウトプット→アウトカムの接続が制度上どう登録されているかを示す。\n'
        '- 接続が多段でアウトカムまで到達していれば、成果への経路が構造として設計されている。\n'
        '- 接続が未登録・浅い場合は、概要文が整っていても経路が描けていないとみなす。\n'
        '- 逆にロジックモデルが登録されていても、概要文で対象・課題が特定できなければ上位にしない。\n'
        + _anchor_block('成果設計の明確さ', anchors['anchors'], detail_by_pid, 'logic') + '\n\n'

        '━━━ 段階2: 成果の検証可能性（evidence）━━━\n'
        'その事業の成果を、第三者が後から検証できる状態にあるか。\n\n'
        '**判定材料は次の2つ。両方を必ず見ること。片方だけで決めないこと。**\n'
        '  (1) 登録された成果指標（制度上の登録データ。指標名・単位・目標値・実績値・達成率・出典）\n'
        '  (2) 事業概要の記述（目的・現状課題・概要に引用された統計、評価結果、実績の記述）\n\n'
        'どちらか一方にしか証拠が無い事業が実在する。\n'
        '- 登録指標に実績があるのに、概要文には数値を一切書いていない事業がある。\n'
        '  この場合は登録データを根拠に高く付ける。概要文に数字が無いことを理由に下げてはいけない。\n'
        '- 逆に登録は活動指標だけでも、概要文に統計や評価結果を引いている事業がある。\n'
        '  この場合はその記述を証拠として拾う。ただし登録指標体系の外にあるぶん、上位には届かない。\n\n'
        '段階（下から上へ）:\n'
        '  0-1: 登録指標も概要文の記述も無い\n'
        '  2-3: 登録はアクティビティ（実施した活動の件数等）のみで、概要文にも成果の記述がない\n'
        '  4-5: アウトプット実績がある、または概要文に成果の裏づけとなる記述がある\n'
        '  6-7: 活動実績が達成率まで追え、かつ概要文にも複数の裏づけがある。'
        'または登録アウトカム実績はあるが単発\n'
        '  8-9: 登録アウトカムに実績がある。出典が明記されていればさらに上\n'
        '  10 : アウトカム実績・達成率・出典がそろい、概要文とも整合する\n\n'
        '注意:\n'
        '- アクティビティ指標をアウトカム実績と混同しないこと。研修の受講者数は活動量であって成果ではない。\n'
        '- 指標の件数が多いこと自体は加点しない。実績が入っているかで決まる。\n'
        '- 定性的なアウトカムしか無い場合は 3-5 程度にとどめる。\n'
        '- finding にはどちらの材料で判断したかを書くこと'
        '（例「登録アウトカム実績と出典あり」「登録は活動指標のみだが概要文に統計の引用あり」）。\n'
        + _anchor_block('成果の検証可能性', anchors['evidenceAnchors'], detail_by_pid, 'indicators') + '\n\n'

        '━━━ 段階3: 費用対内容（proportionality）━━━\n'
        'その金額が活動内容と規模に見合っているか。そして**その金が誰に渡っているか**。\n'
        '金額の見合いと支出先の妥当性を一体で見ます。予算見積りの精度（不用率）は機械計算で別途扱うため対象外です。\n\n'
        '判定手順:\n'
        '1. 本文から活動の規模を表す数量を拾う（対象人数・箇所数・延長・件数・法人数など）。\n'
        '2. 予算額をその数量で割り、単価に換算する。\n'
        '3. 支出先の一覧を見て、その金が名目上の受益者に届いているかを確認する。\n'
        '4. 単価の妥当性と支出先の妥当性を併せて判断する。どちらか一方でも崩れていれば低くなります。\n\n'
        '支出先の妥当性で見る点:\n'
        '- 受益者の乖離: 「国民のため」と称しながら、資金の大半がコンサルタント・シンクタンク・\n'
        '  業界団体など特定の受注事業者に流れていないか。国民は受益者か、それとも名目か。\n'
        '- 中身の空洞: 契約概要が「〜に係る業務」等で、何を購入したのか判別できないか。\n'
        '- 資金の停留: 基金や執行管理法人で資金が止まり、最終的な配分先が追えないか。\n'
        '- 再委託の階層: depth が1以上の支出先は下請けである。元請けが実務を行わず中抜きしていないか。\n'
        '  depth 2以上の先に多額が流れている場合、元請けの付加価値を説明できるかを問う。\n'
        '- 「その他」への集中: 支出先名が「その他」で相当額が計上されている場合、その部分は誰に渡ったか不明。\n'
        '  金額シェアに応じて減点する。\n\n'
        '次は減点理由として認めない:\n'
        '- 金額が大きいこと自体。給付や負担金は対象者数に比例して大きくなるのが当然。\n'
        '- 支出先が1者に集中していること自体。受益者が一種類（年金受給者など）なら当然そうなる。\n'
        '  問題は集中ではなく、集中先が受益者ではなく受注事業者であること。\n'
        '- 記述が明瞭なだけで高評価にしない。よく書けていても単価や支出先が説明できなければ低い。\n'
        '- 事業の必要性の弱さ。それは段階4で採点する。ここでは支出の中身だけを見る。\n'
        '- finding には必ず単価換算を書くこと（例「2.4億円÷1万人＝約2.4万円/人」）。\n'
        '- 金額は提示された budgetOku（億円）をそのまま使う。桁を読み替えないこと。\n'
        '- 予算額が0または未提示の事業は score を null にする。0円で単価を計算しない。\n'
        + _anchor_block('費用対内容', anchors['proportionalityAnchors'], detail_by_pid, 'recipients') + '\n\n'

        '━━━ 段階4: 必要性（necessity）━━━\n'
        'この事業を廃止したら、具体的に誰がどう困るか。高いほど「廃止できない」＝良い評価です。\n'
        '「国の役割である」「重要である」という抽象的な正当化はどの事業にも用意されています。\n'
        'それを受け入れると全事業が高得点になり、この観点は機能しません。抽象的な正当化は認めないでください。\n\n'
        '判定手順:\n'
        '1. 廃止シナリオを書く: 来年度から止めたとき、具体的に誰が何をできなくなるか。\n'
        '   「〇〇が推進されなくなる」ではなく「××が△△を受けられなくなる」という具体で述べる。\n'
        '2. 代替経路を洗い出す。次のすべてを検討すること:\n'
        '   a. 民間・市場が担えないか（担えないならなぜ市場が失敗するのか）\n'
        '   b. 自治体・業界団体・受益者自身が負担すべきものではないか\n'
        '   c. 規制・税制・情報提供など補助金以外の手段で達成できないか\n'
        '   d. 他事業に統合できないか\n'
        '   e. 技術・自動化で同じ成果をより安く出せないか。\n'
        '      文献検索・分類・転記・集計・翻訳・定型的な審査補助のような情報処理を人手で買っている場合、\n'
        '      現在の技術で単価を大きく下げられる可能性がある。件数と単価が示されていれば必ず突き合わせる。\n'
        '3. 代替経路のコストを、この事業と比べて判定する。存在の有無だけで終わらせない。\n'
        '   判定は「安い」「同等」「割高」「不明」のいずれかとし、この4語のうち1語を必ず finding に入れる。\n'
        '   件数や単価が示されているなら、それを根拠として finding に書く（例「18.2万円/件」）。\n'
        '   より高くつく代替を「代替手段あり」と数えてはならない。逆に、安い代替を見落としてもならない。\n'
        '   代替経路が思いつかない場合も「代替なし」と明記する。空欄にしない。\n'
        '4. 代替を阻んでいる要因を特定する。次のどれかを finding に明示すること:\n'
        '   技術（現在の技術では実現できない）／制度（法令が実施主体や方法を限定している）／\n'
        '   責任・裁量（最終判断に公的な責任が伴い機械化できない）／なし（惰性で続いている）\n'
        '   「制度」が理由の場合、それは物理的な不可能ではなく法改正で動かせる制約である。\n'
        '   機能が不可欠であることと、その法令が定めた手段・価格が不可欠であることは別問題として扱う。\n'
        '5. 採点する: 廃止による具体的な不利益が大きく、かつ同等以下のコストの代替経路が無いほど高い。\n'
        '   困る人を特定できない、または同等以下のコストで代替できるなら低い。\n'
        '   機能そのものは不可欠でも、その手段・単価に代替余地があるなら中位にとどめる。\n\n'
        '減点する状況:\n'
        '- 廃止しても誰が困るか具体的に書けない（抽象語でしか答えられない）\n'
        '- 受益者がごく限られた集団で、なぜその集団に公費を投じるのかが説明されていない\n'
        '- 創設時の前提が変わり役割を終えている／民間・自治体が既に同種のことを行っている\n'
        '- 目的が「推進」「強化」等で、成果が出なくても継続できる構造\n\n'
        '点検・評価の扱い:\n'
        '- 外部有識者やレビュー推進チームの所見が提示されている場合、それは所管庁の作文ではない独立した証拠である。\n'
        '  廃止・縮小・抜本的見直しを求める所見があれば、必要性の判定に強く反映する。\n'
        '- 逆に、所見が「継続が妥当」と述べていても、その理由が抽象的なら鵜呑みにしない。\n'
        '- 所見が無いこと自体は減点理由にしない。\n\n'
        '減点しない状況:\n'
        '- 法令で実施が義務づけられている（ただし義務であること自体を根拠に満点にもしない）\n'
        '- 予算規模が大きい／小さいこと自体\n'
        '- 現行の支出先や単価が妥当かどうか。それは段階3で採点済み。\n'
        '  ただし「代替経路のコスト」は段階3ではなくこの観点で扱う。\n'
        '  段階3は今のやり方の値付け、この観点は代替したときの値付けであり、別のものである。\n\n'
        'finding は次の3点をこの順で、80字以内で必ず書くこと。1つでも欠けているものは不備とみなす。\n'
        '  (1) 廃止したとき困る主体と、失われるもの\n'
        '  (2) 代替経路と、そのコスト判定。'
        '「安い」「同等」「割高」「不明」「代替なし」のいずれかの語を必ず含めること\n'
        '  (3) 代替を阻む要因（技術／制度／責任・裁量／なし）\n'
        '書き方の例:\n'
        '  審査官が先行技術調査を失う。自動化で安い見込み(18.2万円/件)。制度\n'
        '  ASEAN各国が地域調整を失う。二国間協力は割高。責任\n'
        '  困るのは受注コンサルのみ。既存統計で同等。なし\n'
        + _anchor_block('必要性', anchors['necessityAnchors'], detail_by_pid, 'recipients') + '\n\n'

        '全観点に共通:\n'
        '- 文章量や言い回しの巧拙で判断しない。対象・活動・便益・根拠がどれだけ特定できるかで見る。\n'
        '- 各観点は独立している。ある観点が高いからといって他も高くしない。\n'
        '- 各項目に nearestAnchor と、40字以内の finding を必ず書く。\n'
        '- category / design / evidence / proportionality / necessity の5配列すべてに、\n'
        '  全indexを漏れなく一度ずつ含めること。'
    )


def unified_key(d):
    """段階採点のキャッシュキー。'U7:' = unified v13（必要性に技術代替とコスト比較を追加）。"""
    tops = '|'.join(f"{r['name']}:{r.get('amount') or 0}:{r.get('depth') or 0}"
                    for r in (d.get('topRecipients') or []))
    c = d.get('indicatorCounts') or {}
    rv = d.get('review') or {}
    raw = '|'.join([
        normalize(d.get('purpose', '')), normalize(d.get('currentIssues', '')),
        normalize(d.get('overview', '')),
        f"{d.get('budgetAmount') or 0}", f"{d.get('execAmount') or 0}", tops,
        f"{c.get('total', 0)}:{c.get('withActual', 0)}:{c.get('outcomeWithActual', 0)}:{c.get('withSource', 0)}",
        normalize(rv.get('expertOpinion', ''))[:200], normalize(rv.get('teamOpinion', ''))[:200],
    ])
    return 'U7:' + hashlib.sha1(raw.encode('utf-8')).hexdigest()


def heuristic_unified(d):
    """APIキー無し時のフォールバック。設計のみ従来ヒューリスティック、他は未評価。"""
    base = heuristic_effect(d)
    return {'category': None, 'design': base['effective'], 'evidence': None,
            'proportionality': None, 'necessity': None,
            'designFinding': '', 'evidenceFinding': '',
            'proportionalityFinding': '', 'necessityFinding': '', 'reason': 'heuristic'}


def _build_unified_prompt(items):
    lines_ = ['次の各事業を、段階0（分類）→段階1（設計）→段階2（検証可能性）→段階3（費用対内容）→段階4（必要性）の順に処理してください。\n']
    for idx, d in enumerate(items):
        lines_.append(
            f"[{idx}] 事業名: {d.get('projectName', '')}\n"
            f"  目的: {(d.get('purpose') or '(空)')[:600]}\n"
            f"  現状課題: {(d.get('currentIssues') or '(空)')[:400]}\n"
            f"  概要: {(d.get('overview') or '(空)')[:400]}\n"
            f"  budgetOku: {'—' if d.get('budgetAmount') is None else round(d['budgetAmount'] / 1e8, 1)}"
            f" / 執行率{_fmt_pct(d.get('executionRate'))} / 前年度{_fmt_pct(d.get('priorExecutionRate'))}\n"
            f"  {_fmt_recipients(d)}\n"
            f"  {_fmt_indicators(d)}\n"
            f"  {_fmt_logic(d)}\n"
            f"  {_fmt_related(d)}\n"
            f"  {_fmt_review(d)}"
        )
    lines_.append(_JSON_INSTRUCT +
                  '{"category":[{"i":<index>,"id":"<類型id>"}, ...],'
                  '"design":[{"i":<index>,"nearestAnchor":<整数>,"score":<0〜10>,"finding":"<40字以内>"}, ...],'
                  '"evidence":[{"i":<index>,"nearestAnchor":<整数>,"score":<0〜10>,"finding":"<40字以内>"}, ...],'
                  '"proportionality":[{"i":<index>,"nearestAnchor":<整数>,"score":<0〜10またはnull>,"finding":"<単価換算を含め40字以内>"}, ...],'
                  '"necessity":[{"i":<index>,"nearestAnchor":<整数>,"score":<0〜10またはnull>,"finding":"<40字以内>"}, ...]}')
    return '\n'.join(lines_)


_UNIFIED_SYSTEM = None
_TAXONOMY_IDS = set()


def unified_chunk(client, items, model):
    """段階採点1チャンク。5配列をindexで突き合わせて1件ずつにまとめる。
    設計以外の欠落は None（未評価）として扱い、チャンク全体を捨てない。"""
    data = llm_json(client, model, _UNIFIED_SYSTEM, _build_unified_prompt(items))
    by = {}
    for axis in ('category', 'design', 'evidence', 'proportionality', 'necessity'):
        by[axis] = {int(r['i']): r for r in (data.get(axis) or []) if 'i' in r}
    out = {}
    for i in range(len(items)):
        d = by['design'].get(i)
        if d is None:
            continue
        e, pr, ne = by['evidence'].get(i), by['proportionality'].get(i), by['necessity'].get(i)
        cat = by['category'].get(i)
        cid = str(cat.get('id')) if cat and str(cat.get('id')) in _TAXONOMY_IDS else None
        sc = lambda r: None if (r is None or r.get('score') is None) else _clamp_lvl(r.get('score'), 10)
        out[i] = {
            'category': cid,
            'design': _clamp_lvl(d.get('score'), 10),
            'evidence': sc(e), 'proportionality': sc(pr), 'necessity': sc(ne),
            'designFinding': (d.get('finding') or '')[:80],
            'evidenceFinding': ((e or {}).get('finding') or '')[:80],
            'proportionalityFinding': ((pr or {}).get('finding') or '')[:80],
            'necessityFinding': ((ne or {}).get('finding') or '')[:80],
            'reason': (d.get('finding') or ''),
        }
    return out


def _vote_key(base, vote):
    """k投票用のキャッシュキー。1票目は従来キーと同一にして、既存キャッシュを捨てずに再利用する。"""
    return base if vote <= 1 else f'{base}#v{vote}'


def _combine_votes(js):
    """同一入力をk回採点した結果を1件に統合する。

    実測（docs/quality-evaluation-benchmark.md）で、1回目→2回目のブレは軸間で無相関
    （|r|<0.14）＝軸ごとに独立なノイズだと確認できている。よって単純平均で
    測定誤差σが 1/√k に落ちる。中央値ではなく平均を採るのは、小数を残すことで
    0-10の離散スケールで潰れていた弁別力（タイの多さ）も同時に回復するため。
    """
    js = [j for j in js if j]
    if not js:
        return None
    if len(js) == 1:
        return js[0]
    out = {}
    for f in ('design', 'evidence', 'proportionality', 'necessity'):
        vals = [j.get(f) for j in js if j.get(f) is not None]
        # 過半数の票が「未評価」なら未評価のまま。少数の欠測は残りの票の平均で埋める
        out[f] = round(sum(vals) / len(vals), 2) if len(vals) * 2 > len(js) else None
    if out['design'] is None:
        return None                      # 設計が無い＝この事業は未判定扱い（下流が前提にしている）
    cats = [j.get('category') for j in js if j.get('category')]
    # 類型は多数決。同数なら先の票を優先する
    out['category'] = max(set(cats), key=lambda c: (cats.count(c), -cats.index(c))) if cats else None
    # 判定理由は平均値に最も近い票のものを採る（平均と矛盾する理由文を出さないため）
    near = min(js, key=lambda j: abs((j.get('design') if j.get('design') is not None else 0) - out['design']))
    for f in ('designFinding', 'evidenceFinding', 'proportionalityFinding', 'necessityFinding', 'reason'):
        out[f] = near.get(f, '')
    out['votes'] = len(js)
    return out


def judge_unified_sync(client, uniques, model, batch_size, cache=None, cache_path=None):
    """段階採点。5配列ぶん出力するのでバッチは小さめに。"""
    set_usage_phase('policy')
    bs = max(1, min(batch_size, 6))
    return _run_batches(client, uniques, model, bs,
                        unified_chunk, heuristic_unified, '政策評価', cache, cache_path)



# ── 軸E: 有効性（成果設計の明確さ）— 事業単位でprojectのテキストをAI判定 ──
# ※ 実測成果ではなく「国民生活への寄与がどれだけ明確・妥当に説明されているか」を測る意図ベース指標
EFFECT_SYSTEM = (
    "あなたは日本の行政事業レビューの評価官です。各事業の『目的・現状課題・概要』のテキストから、"
    "その事業が国民生活にどれだけ寄与するかが明確かつ妥当に説明されているかを評価します。\n"
    "実際に効果が出たかの実測ではなく、成果設計（誰のどんな課題を、どの活動で、どう改善するか）の"
    "明確さと論理的妥当性を判定してください。\n\n"
    "【effective（有効性／成果設計の明確さ 0〜10の11段階）】\n"
    "国民生活への寄与が『どれだけ明確・妥当・説得的に説明されているか』を0〜10で細かく採点する。\n"
    " 0  =記載が空、または寄与が全く読み取れない\n"
    " 1-2=目的は辛うじて分かるが、活動と便益の紐づきが極めて弱い／抽象的\n"
    " 3-4=目的は分かるが、対象や活動が曖昧で便益の論理が弱い\n"
    " 5-6=対象・課題・活動は概ね具体的だが、国民への便益の説得力は中程度\n"
    " 7-8=対象・課題・活動・期待便益が具体的で論理が通り、寄与が概ね説得的\n"
    " 9-10=対象・課題・活動・期待便益が具体的かつ論理が明確で、国民生活への寄与が高い説得力\n"
    "中間の値も積極的に使い、0/5/10だけに偏らせないこと。\n\n"
    "reason には、その点数にした根拠を60字程度で具体的に書くこと"
    "（対象・活動・期待便益の具体性や、弱い点に触れる）。"
)

_BENEFIT_KW = re.compile(
    r'(国民|生活|住民|安全|安心|防止|削減|向上|改善|支援|促進|普及|確保|育成|雇用|健康|医療|福祉|'
    r'教育|防災|環境|被害|負担軽減|効率化|競争力|地域|経済成長)'
)
_NUM_KW = re.compile(r'[0-9０-９]+\s*(%|％|割|件|人|社|億|兆|万|年|か月|箇所|地域)')


def effect_key(d):
    # 'E10:' = 有効性0-10スケール版（旧'E:'は0-3版で別キー＝再判定される）
    raw = '|'.join([normalize(d.get('purpose', '')), normalize(d.get('currentIssues', '')),
                    normalize(d.get('overview', ''))])
    return 'E10:' + hashlib.sha1(raw.encode('utf-8')).hexdigest()


def heuristic_effect(d):
    purpose = normalize(d.get('purpose', '')).strip()
    overview = normalize(d.get('overview', '')).strip()
    issues = normalize(d.get('currentIssues', '')).strip()
    text = f'{purpose}\n{overview}\n{issues}'
    body_len = len(purpose) + len(overview)
    if body_len < 20:
        return {'effective': 0, 'reason': 'heuristic'}
    benefit_hits = len(set(_BENEFIT_KW.findall(text)))
    has_num = bool(_NUM_KW.search(text))
    # 0-10スケールの粗い近似（フォールバック用）
    score = 3
    if body_len >= 60:
        score += 2
    if benefit_hits >= 2:
        score += 2
    if benefit_hits >= 4:
        score += 2
    if has_num:
        score += 1
    return {'effective': min(10, max(2, score)), 'reason': 'heuristic'}


def _build_effect_prompt(items):
    lines = ["次の各事業を評価してください。\n"]
    for idx, d in enumerate(items):
        lines.append(
            f"[{idx}] 事業名: {d.get('projectName', '')}\n"
            f"  目的: {(d.get('purpose') or '(空)')[:600]}\n"
            f"  現状課題: {(d.get('currentIssues') or '(空)')[:400]}\n"
            f"  概要: {(d.get('overview') or '(空)')[:400]}"
        )
    lines.append(_JSON_INSTRUCT +
                 '{"results":[{"i":<index>,"effective":<0〜10の整数>,'
                 '"reason":"<60字程度。点数の根拠を具体的に>"}, ...]}')
    return "\n".join(lines)


def effect_chunk(client, items, model):
    data = llm_json(client, model, EFFECT_SYSTEM, _build_effect_prompt(items))
    out = {}
    for r in data.get("results", []):
        out[int(r["i"])] = {"effective": _clamp_lvl(r.get("effective"), 10),
                            "reason": r.get("reason", "")}
    return out


def judge_effect_sync(client, uniques, model, batch_size, cache=None, cache_path=None):
    """有効性（軸E）の判定。事業テキストは長いのでバッチは小さめ。"""
    bs = max(1, min(batch_size, 8))
    return _run_batches(client, uniques, model, bs,
                        effect_chunk, heuristic_effect, '有効性判定', cache, cache_path)


def judge_effect_batch(client, uniques, model, batch_size, cache=None, cache_path=None):
    """OpenRouter版: 専用Batch APIは未配線。同期（並列）チャンク呼び出しにフォールバック。"""
    return judge_effect_sync(client, uniques, model, batch_size, cache, cache_path)


# ── メイン ──
def main():
    print(f'年度: {YEAR} / モデル: {MODEL} / ゲート: {"ON" if GATE else "OFF"} / '
          f'並列: {CONCURRENCY}')

    recipients = load_json_maybe_gz(RECIPIENTS_JSON, RECIPIENTS_JSON_GZ)
    with open(SCORES_JSON, encoding='utf-8') as f:
        scores = json.load(f)
    try:
        details = load_json_maybe_gz(DETAILS_JSON, DETAILS_JSON_GZ)
    except FileNotFoundError:
        details = {}
        print('  [warn] project-details が見つからないため軸E（有効性）はスキップ')
    print(f'  事業: {len(scores):,} / per-recipient事業: {len(recipients):,} / 詳細: {len(details):,}')

    # アンカー事業は --limit で切り詰めた後も参照するため、予算実績を先に控えておく
    budget_by_pid = {it['pid']: (it.get('budgetAmount') or 0, it.get('execAmount') or 0) for it in scores}
    if args.benchmark:
        with open(BENCHMARK_JSON, encoding='utf-8') as f:
            bench_pids = {str(x['pid']) for x in json.load(f)['projects']}
        scores = [it for it in scores if str(it['pid']) in bench_pids]
        print(f'  --benchmark: ベンチマークセット{len(scores)}事業のみ評価（本番データは上書きしない）')
    if args.limit > 0:
        keep = {it['pid'] for it in scores[:args.limit]}
        scores = [it for it in scores if it['pid'] in keep]
        print(f'  --limit {args.limit}: 先頭{len(scores)}事業のみ')

    # 1. キャッシュ
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = {}
    if CACHE_FILE.exists() and not args.force:
        with open(CACHE_FILE, encoding='utf-8') as f:
            cache = json.load(f)
        print(f'  キャッシュ: {len(cache):,}件ロード')

    # 2. 全行を走査 → ユニークタプル抽出 + ゲート即決
    pids = {it['pid'] for it in scores}
    need_ai = {}      # key -> item（AI判定が必要なユニーク）
    gated = {}        # key -> judgment（ゲート即決）
    row_keys = {}     # pid -> [(row, key)]
    for pid in pids:
        rows = recipients.get(pid, [])
        rk = []
        for row in rows:
            key = tuple_key(row)
            rk.append((row, key))
            if key in cache or key in need_ai or key in gated:
                continue
            if GATE:
                g = gate_judgment(row)
                if g is not None:
                    gated[key] = g
                    continue
            need_ai[key] = row
        row_keys[pid] = rk

    print(f'  ユニーク判定対象: AI={len(need_ai):,} / ゲート即決={len(gated):,} / '
          f'キャッシュ済={sum(1 for pid in pids for _, k in row_keys[pid] if k in cache):,}')

    # 3. AI判定（実OpenRouter or ヒューリスティック）
    api_key = os.environ.get('OPENROUTER_API_KEY')
    client = None
    if api_key:
        try:
            client = make_client()
        except ImportError:
            print('  [error] openai 未インストール。pip install openai 後に再実行してください。',
                  file=sys.stderr)
            sys.exit(1)
    ai_source = f'openrouter:{MODEL}' if api_key else 'heuristic'

    # ゲート即決は決定的なので保存可。AI判定の前にcacheへ入れておき逐次フラッシュ対象にする。
    cache.update(gated)

    # 3a. 軸A・B（支出先の特定可能性・使途）
    # 実AI成功分は judge_uniques_sync 内で cache に逐次保存・フラッシュ（中断耐性）。
    # ヒューリスティック(fill/全体)は cache を汚さない＝後の実AI再実行で再判定される。
    uniques = list(need_ai.items())
    if uniques and client:
        judged = (judge_uniques_batch(client, uniques, MODEL, args.batch_size, cache, CACHE_FILE) if args.batch
                  else judge_uniques_sync(client, uniques, MODEL, args.batch_size, cache, CACHE_FILE))
    else:
        if uniques and not api_key:
            print('  [info] OPENROUTER_API_KEY 未設定 → ヒューリスティック判定（aiSource=heuristic）')
        judged = {k: heuristic_judge(it) for k, it in uniques}
    judge_map = dict(cache)
    judge_map.update(judged)   # 実AI分はcacheに既存。fillはここで補完（永続化しない）

    # 3b. 政策3軸（成果設計 / 検証可能性 / 計上額の妥当性）を段階採点（重複排除・キャッシュ）
    #     アンカー定義があれば段階採点、無ければ旧・軸E単独採点にフォールバックする。
    global _UNIFIED_SYSTEM, _TAXONOMY_IDS
    anchors = load_anchors()
    tax = load_taxonomy()
    if tax is None:
        anchors = None
        print('  [info] 政策類型の定義が見つかりません')
    else:
        _TAXONOMY_IDS = taxonomy_ids(tax)

    # 成果指標（3-1）・点検評価（4-1）。長らく取り込んでおらず、検証可能性を誤判定していた。
    try:
        outcomes = load_json_maybe_gz(OUTCOMES_JSON, OUTCOMES_JSON_GZ)
        n_act = sum(1 for v in outcomes.values() if (v.get('indicatorCounts') or {}).get('withActual'))
        print(f'  成果指標・点検: {len(outcomes):,}事業（実績値あり {n_act:,}）')
    except FileNotFoundError:
        outcomes = {}
        print('  [warn] rs{}-project-outcomes.json が無いため成果指標・点検を投入できません。'
              ' python3 scripts/generate-project-outcomes.py --year {} を実行してください。'.format(YEAR, YEAR))

    # 支出先の上位（費用対内容・必要性の判定材料）。役所の作文が支配できない証拠として使う。
    TOP_N = 5
    top_recipients = {}
    for pid_, rows_ in recipients.items():
        if not rows_:
            continue
        total_ = sum((r.get('a2') or 0) for r in rows_)
        top_recipients[str(pid_)] = {
            'count': len(rows_),
            'rows': [{
                'name': r.get('n', ''),
                'amount': r.get('a2'),
                'share': ((r.get('a2') or 0) / total_) if total_ > 0 else None,
                'role': r.get('role') or '',
                'contract': r.get('cc') or '',
                'chain': r.get('chain') or '',
                'depth': r.get('d') or 0,
            } for r in sorted(rows_, key=lambda x: -(x.get('a2') or 0))[:TOP_N]],
        }

    # 前年度の執行率（計上額の妥当性の判定材料）。無い年度・無い事業は None＝判定不能。
    prior_rate = {}
    try:
        prior = load_json_maybe_gz(PRIOR_SCORES_JSON, PRIOR_SCORES_GZ)
        for r in prior:
            if r.get('budgetAmount', 0) > 0 and r.get('execAmount', 0) > 0:
                prior_rate[r['pid']] = r['execAmount'] / r['budgetAmount']
    except Exception:
        print(f'  [info] 前年度({int(YEAR) - 1})データなし → 計上額の妥当性は当年度のみで判定')

    def _with_budget(d, it):
        b, e = it.get('budgetAmount') or 0, it.get('execAmount') or 0
        tops = top_recipients.get(str(it['pid'])) or {}
        oc = outcomes.get(str(it['pid'])) or {}
        return {**d,
                'indicators': oc.get('indicators', []),
                'indicatorCounts': oc.get('indicatorCounts', {}),
                'review': oc.get('review'),
                'logicModel': oc.get('logicModel'),
                'relatedProjects': oc.get('relatedProjects', []),
                'logicModel': oc.get('logicModel'),
                'relatedProjects': oc.get('relatedProjects', []),
                'projectName': d.get('projectName', it.get('name', '')),
                'budgetAmount': b or None,
                'execAmount': e or None,
                'executionRate': (e / b) if (b > 0 and e > 0) else None,
                'priorExecutionRate': prior_rate.get(it['pid']),
                'recipientCount': tops.get('count', 0),
                'topRecipients': tops.get('rows', [])}

    eff_key_by_pid = {}
    eff_all = {}      # 基準キー → enriched。投票ごとに同じ入力を使い回す
    for it in scores:
        pid = it['pid']
        d = details.get(pid) or details.get(str(pid))
        if not d:
            continue
        enriched = _with_budget(d, it)
        k = unified_key(enriched) if anchors else effect_key(d)
        eff_key_by_pid[pid] = k
        if k not in eff_all:
            eff_all[k] = enriched
    eff_need = {k: v for k, v in eff_all.items() if k not in cache}
    eff_uniques = list(eff_need.items())

    if anchors:
        # アンカー事業の本文・予算実績をプロンプトへ埋め込むため、pid で引ける辞書を作る
        anchor_pids = {str(a['pid']) for group in ('anchors', 'evidenceAnchors', 'proportionalityAnchors', 'necessityAnchors')
                       for a in anchors[group] if a.get('pid')}
        by_pid = {}
        for pid in anchor_pids:
            d = details.get(pid)
            if not d:
                continue
            b, e = budget_by_pid.get(pid, (0, 0))
            by_pid[pid] = _with_budget(d, {'pid': pid, 'name': d.get('projectName', ''),
                                           'budgetAmount': b, 'execAmount': e})
        missing_anchor = anchor_pids - set(by_pid)
        if missing_anchor:
            print(f'  [warn] アンカー事業の詳細が見つかりません: {sorted(missing_anchor)}')
        _UNIFIED_SYSTEM = build_unified_system(anchors, tax, by_pid)
        label = '政策3軸'
    else:
        print('  [info] アンカー定義なし → 旧・軸E単独採点にフォールバック')
        label = '有効性'

    if args.dump_prompt:
        print('=' * 100)
        print(_UNIFIED_SYSTEM if anchors else '(アンカー未設定のため旧方式)')
        print('=' * 100)
        if eff_uniques:
            print(_build_unified_prompt([it for _, it in eff_uniques[:2]]))
        raise SystemExit(0)

    # k投票。同一入力・同一チャンク構成でVOTES回採点し、軸ごとに平均を採る。
    # 1票目のキーは従来と同一なので、既に済んでいる1回分の走行結果はそのまま流用される。
    VOTES = max(1, args.votes) if anchors else 1
    if VOTES > 1:
        pending = sum(1 for k in eff_all for v in range(1, VOTES + 1) if _vote_key(k, v) not in cache)
        print(f'  {label} 判定対象: {len(eff_all):,}事業 × {VOTES}投票 = 要判定={pending:,} / '
              f'キャッシュ済={len(eff_all) * VOTES - pending:,} / 詳細なし={len(scores) - len(eff_key_by_pid):,}')
    else:
        print(f'  {label} 判定対象: 要判定={len(eff_uniques):,} / '
              f'キャッシュ済={len(eff_key_by_pid) - len(eff_uniques):,} / 詳細なし={len(scores) - len(eff_key_by_pid):,}')

    judged_all = {}      # 投票キー → 判定（ヒューリスティック補完を含む。cacheには入らない）
    if eff_all and client and anchors:
        for v in range(1, VOTES + 1):
            need = [(_vote_key(k, v), it) for k, it in eff_all.items() if _vote_key(k, v) not in cache]
            if not need:
                continue
            if VOTES > 1:
                print(f'  ── 投票 {v}/{VOTES}（要判定 {len(need):,}）──')
            judged_all.update(judge_unified_sync(client, need, MODEL, args.batch_size, cache, CACHE_FILE))
    elif eff_uniques and client:
        judged_all = (judge_effect_batch(client, eff_uniques, MODEL, args.batch_size, cache, CACHE_FILE) if args.batch
                      else judge_effect_sync(client, eff_uniques, MODEL, args.batch_size, cache, CACHE_FILE))
    else:
        if eff_uniques and not api_key:
            print(f'  [info] {label}もヒューリスティックで判定')
        fallback = heuristic_unified if anchors else heuristic_effect
        judged_all = {k: fallback(it) for k, it in eff_uniques}

    def _lookup(key):
        return judged_all.get(key) or cache.get(key)

    if anchors:
        eff_map = {}
        for k in eff_all:
            combined = _combine_votes([_lookup(_vote_key(k, v)) for v in range(1, VOTES + 1)])
            if combined:
                eff_map[k] = combined
        if VOTES > 1:
            got = [e.get('votes', 1) for e in eff_map.values()]
            full = sum(1 for g in got if g == VOTES)
            print(f'  投票統合: {len(eff_map):,}事業（全{VOTES}票そろい {full:,} / 一部欠票 {len(got) - full:,}）')
    else:
        eff_map = dict(cache)
        eff_map.update(judged_all)   # 実AI分はcacheに既存。fillはここで補完（永続化しない）

    _flush_cache(cache, CACHE_FILE)

    # 4. プロジェクト集計（金額加重 → 軸A・軸B）+ 軸C・軸D機械計算 + 総合再計算
    for it in scores:
        pid = it['pid']
        rk = row_keys.get(pid, [])

        sum_amt = 0
        wi = wp = 0.0          # 金額加重和
        ci = cp = 0            # 件数（金額欠落フォールバック用）
        si = sp = 0.0
        lvl_i_sum = lvl_p_sum = 0
        lvl_amt = 0
        for row, key in rk:
            j = judge_map.get(key) or heuristic_judge(row)
            si_pt = LEVEL_TO_SCORE[j['identify']]
            sp_pt = LEVEL_TO_SCORE[j['purpose']]
            amt = row.get('a2') or 0
            if amt and amt > 0:
                wi += si_pt * amt
                wp += sp_pt * amt
                lvl_i_sum += j['identify'] * amt
                lvl_p_sum += j['purpose'] * amt
                lvl_amt += amt
                sum_amt += amt
            si += si_pt
            sp += sp_pt
            ci += 1
            cp += 1

        if sum_amt > 0:
            it['axisIdentify'] = round(wi / sum_amt, 1)
            it['axisPurpose'] = round(wp / sum_amt, 1)
            it['identifyLevelAvg'] = round(lvl_i_sum / lvl_amt, 2)
            it['purposeLevelAvg'] = round(lvl_p_sum / lvl_amt, 2)
        elif ci > 0:
            it['axisIdentify'] = round(si / ci, 1)
            it['axisPurpose'] = round(sp / cp, 1)
            it['identifyLevelAvg'] = None
            it['purposeLevelAvg'] = None
        else:
            it['axisIdentify'] = None
            it['axisPurpose'] = None
            it['identifyLevelAvg'] = None
            it['purposeLevelAvg'] = None

        # 軸C 収支整合性（許容バンド付き）— gapRatio は既存signalから
        gap = it.get('gapRatio')
        if gap is None:
            it['axisBudget'] = None
        elif gap <= BUDGET_TOLERANCE:
            it['axisBudget'] = 100.0
        else:
            it['axisBudget'] = round(clamp((1 - (gap - BUDGET_TOLERANCE) / (1 - BUDGET_TOLERANCE)) * 100), 1)

        # 軸D 構造整合性 — 旧axis4から再委託深度減点を除外し、金額不整合＋孤立のみ
        old4 = it.get('axis4')
        if old4 is None:
            it['axisStructure'] = None
        else:
            redel_deduct = min((it.get('redelegationDepth') or 0) * 10, 40) if it.get('hasRedelegation') else 0
            inco_deduct = max(0, (100 - old4) - redel_deduct)  # 旧axis4に含まれた金額不整合分
            orphan_deduct = min((it.get('orphanBlockCount') or 0) * 10, 30)
            it['axisStructure'] = round(clamp(100 - inco_deduct - orphan_deduct), 1)

        # 政策3軸（段階採点）。旧 axisEffective 系は成果設計から導出して後方互換を保つ。
        ek = eff_key_by_pid.get(pid)
        ej = eff_map.get(ek) if ek else None
        if ej is None:
            it['axisEffective'] = None
            it['effectiveLevel'] = None
            it['effectiveReason'] = ''
            it['designClarity'] = None
            it['evidenceReadiness'] = None
            it['budgetProportionality'] = None
            it['necessity'] = None
            it['policyCategory'] = None
            it['policyFindings'] = None
        elif 'design' in ej:
            design = ej['design']
            it['axisEffective'] = round(design * 10.0, 1)   # 0-10 → 0-100（既存UI互換）
            it['effectiveLevel'] = design
            it['effectiveReason'] = ej.get('designFinding', '') or ej.get('reason', '')
            it['designClarity'] = design                     # 0-10
            it['evidenceReadiness'] = ej.get('evidence')     # 0-10 / None=未評価
            it['budgetProportionality'] = ej.get('proportionality')  # 0-10 / None（費用対内容）
            it['necessity'] = ej.get('necessity')                    # 0-10 / None=未評価
            it['policyCategory'] = ej.get('category')                # 政策類型 id
            it['policyFindings'] = {
                'design': ej.get('designFinding', ''),
                'evidence': ej.get('evidenceFinding', ''),
                'proportionality': ej.get('proportionalityFinding', ''),
                'necessity': ej.get('necessityFinding', ''),
            }
        else:
            # 旧・軸E単独採点の結果
            it['axisEffective'] = round(ej['effective'] * 10.0, 1)
            it['effectiveLevel'] = ej['effective']
            it['effectiveReason'] = ej.get('reason', '')
            it['designClarity'] = ej['effective']
            it['evidenceReadiness'] = None
            it['budgetProportionality'] = None
            it['necessity'] = None
            it['policyCategory'] = None
            it['budgetProportionality'] = None
            it['policyFindings'] = None

        # 総合（25/20/15/10/30、Noneは除外し残り重みで再配分）
        tw = ws = 0.0
        for axis_key, w in WEIGHTS:
            v = it.get(axis_key)
            if v is not None:
                ws += v * w
                tw += w
        it['totalScore'] = round(ws / tw, 1) if tw > 0 else None
        it['aiSource'] = ai_source

    # 5. 出力（--limit はテスト用なので全件ファイルを上書きしない）
    if args.benchmark:
        BENCHMARK_OUT.mkdir(parents=True, exist_ok=True)
        out_path = BENCHMARK_OUT / f'production-benchmark-{MODEL_SLUG}.json'
        pol = USAGE_BY_PHASE.get('policy', {'prompt_tokens': 0, 'completion_tokens': 0, 'cost': 0.0, 'calls': 0})
        rec = USAGE_BY_PHASE.get('recipient', {'prompt_tokens': 0, 'completion_tokens': 0, 'cost': 0.0, 'calls': 0})
        cost = pol['cost'] + rec['cost']
        payload = {
            'source': 'score-project-quality-ai.py --benchmark',
            'model': MODEL,
            'year': YEAR,
            'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'usage': {'policy': pol, 'recipient': rec, 'total': cost,
                      'policyPerProject': (pol['cost'] / len(scores)) if scores else 0},
            'projects': [{
                'pid': it['pid'], 'name': it.get('name'), 'ministry': it.get('ministry'),
                'budgetAmount': it.get('budgetAmount'), 'execAmount': it.get('execAmount'),
                'policyCategory': it.get('policyCategory'),
                'designClarity': it.get('designClarity'),
                'evidenceReadiness': it.get('evidenceReadiness'),
                'budgetProportionality': it.get('budgetProportionality'),
                'necessity': it.get('necessity'),
                'axisIdentify': it.get('axisIdentify'), 'axisPurpose': it.get('axisPurpose'),
                'policyFindings': it.get('policyFindings'),
            } for it in scores],
        }
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        est = (pol['cost'] / len(scores) * 5794) if (scores and pol['cost']) else 0
        print(f'  [benchmark] {out_path.name} に出力')
        print(f'    政策評価  API {pol["calls"]:>3}回 ${pol["cost"]:.5f} '
              f'({pol["prompt_tokens"] + pol["completion_tokens"]:,}tok) → 全件換算 ${est:.2f}')
        print(f'    支出先判定 API {rec["calls"]:>3}回 ${rec["cost"]:.5f} '
              f'({rec["prompt_tokens"] + rec["completion_tokens"]:,}tok) '
              f'※全件では重複排除が効くため比例換算は不可')
    elif args.limit > 0:
        print(f'  [info] --limit {args.limit} のため {SCORES_JSON.name} は上書きしない（テストモード）')
    else:
        with open(SCORES_JSON, 'w', encoding='utf-8') as f:
            json.dump(scores, f, ensure_ascii=False)

    scored = [it['totalScore'] for it in scores if it.get('totalScore') is not None]
    print(f'\n出力: {SCORES_JSON}')
    print(f'  aiSource: {ai_source}')
    if scored:
        avg = sum(scored) / len(scored)
        print(f'  平均総合スコア: {avg:.1f} / 最高 {max(scored):.1f} / 最低 {min(scored):.1f}')
        bins = [(90, 100), (70, 89.9), (50, 69.9), (0, 49.9)]
        print('  スコア分布:')
        for lo, hi in bins:
            cnt = sum(1 for s in scored if lo <= s <= hi)
            print(f'    {lo:>3.0f}-{hi:>5.1f}: {cnt:>5,}件')


if __name__ == '__main__':
    main()
