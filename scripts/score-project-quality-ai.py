"""
事業別 支出先データ品質スコア — AI評価フェーズ（最終スコアラ）

設計: docs/tasks/20260616_1749_AI支出先データ品質スコアリング再設計.md

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
DETAILS_JSON        = REPO_ROOT / 'public' / 'data' / f'rs{YEAR}-project-details.json'
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

    # 3b. 軸E 有効性（成果設計の明確さ）— 事業テキストを判定（重複排除・キャッシュ）
    eff_key_by_pid = {}
    eff_need = {}
    for it in scores:
        pid = it['pid']
        d = details.get(pid) or details.get(str(pid))
        if not d:
            continue
        k = effect_key(d)
        eff_key_by_pid[pid] = k
        if k not in cache and k not in eff_need:
            eff_need[k] = {**d, 'projectName': d.get('projectName', it.get('name', ''))}
    eff_uniques = list(eff_need.items())
    print(f'  有効性 判定対象: 要判定={len(eff_uniques):,} / '
          f'キャッシュ済={len(eff_key_by_pid) - len(eff_uniques):,} / 詳細なし={len(scores) - len(eff_key_by_pid):,}')
    if eff_uniques and client:
        eff_judged = (judge_effect_batch(client, eff_uniques, MODEL, args.batch_size, cache, CACHE_FILE) if args.batch
                      else judge_effect_sync(client, eff_uniques, MODEL, args.batch_size, cache, CACHE_FILE))
    else:
        if eff_uniques and not api_key:
            print('  [info] 有効性もヒューリスティックで判定')
        eff_judged = {k: heuristic_effect(it) for k, it in eff_uniques}
    eff_map = dict(cache)
    eff_map.update(eff_judged)   # 実AI分はcacheに既存。fillはここで補完（永続化しない）

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

        # 軸E 有効性（成果設計の明確さ）— 事業テキストのAI判定
        ek = eff_key_by_pid.get(pid)
        ej = eff_map.get(ek) if ek else None
        if ej is not None:
            it['axisEffective'] = round(ej['effective'] * 10.0, 1)  # 0-10 → 0-100
            it['effectiveLevel'] = ej['effective']                  # 0-10
            it['effectiveReason'] = ej.get('reason', '')
        else:
            it['axisEffective'] = None
            it['effectiveLevel'] = None
            it['effectiveReason'] = ''

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
    if args.limit > 0:
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
