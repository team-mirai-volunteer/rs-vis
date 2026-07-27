"""
埋め込みモデル選定ベンチマーク（日本語・行政事業テキスト）

バブルチャート（/project-map）の意味的2次元マップに使う埋め込みモデルを、
MTEB等の一般ベンチではなく「このデータで」実測して選ぶためのスクリプト。

正解ラベル:
  policyCategory  … project-quality-scores-{year}.json に付与済みの32分類。
                    同じ本文からAIが付けたラベルなので完全な外部正解ではないが、
                    「意味の近い事業が近くに来るか」の代理としては十分に効く。
  ministry        … 所管府省庁。政策分野と相関はするが独立の軸。
                    府省庁で綺麗に割れすぎるモデルは「役所名を拾っているだけ」の疑い。

指標:
  knnAcc / knnMacroF1  … leave-one-out kNN(k=10, cosine)。局所的な近傍の質。
                         2Dマップのご近所が正しいかに最も近い。
  silhouette           … policyCategoryをクラスタとみなしたシルエット係数(cosine)。
                         大域的な分離の良さ。
  kmeansAri / kmeansNmi… KMeans(k=カテゴリ数)とpolicyCategoryの一致度。
                         実際にクラスタリングして使うので、この値が本番に一番近い。
  umapKnnAcc           … UMAP2次元に落とした後のkNN精度。
                         高次元で良くても2Dに潰すと壊れるモデルがあるため必ず測る。

実行:
  OPENROUTER_API_KEY=... python3 scripts/benchmark-embedding-models.py --year 2025 --sample 600

  埋め込みはモデル×テキストのハッシュでキャッシュするので、再実行は無料。
  結果は tests/benchmark-results/embedding-model-selection-{year}.json に保存。
"""

import argparse
import gzip
import hashlib
import json
import os
import pickle
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public' / 'data'
CACHE_DIR = ROOT / '.cache' / 'embeddings'
OUT_DIR = ROOT / 'tests' / 'benchmark-results'

API_URL = 'https://openrouter.ai/api/v1/embeddings'

# 候補モデル。prefix は e5 系が "passage: " を要求するため（付けないと精度が落ちる）。
# batch は プロバイダごとの1リクエスト上限に合わせた保守的な値。
MODELS = [
    {'id': 'google/gemini-embedding-001',       'batch': 32,  'prefix': ''},
    {'id': 'openai/text-embedding-3-large',     'batch': 128, 'prefix': ''},
    {'id': 'openai/text-embedding-3-small',     'batch': 128, 'prefix': ''},
    {'id': 'qwen/qwen3-embedding-8b',           'batch': 32,  'prefix': ''},
    {'id': 'qwen/qwen3-embedding-4b',           'batch': 32,  'prefix': ''},
    {'id': 'baai/bge-m3',                       'batch': 32,  'prefix': ''},
    {'id': 'intfloat/multilingual-e5-large',    'batch': 32,  'prefix': 'passage: '},
]

parser = argparse.ArgumentParser(description='埋め込みモデル選定ベンチマーク')
parser.add_argument('--year', type=int, default=2025)
parser.add_argument('--sample', type=int, default=600, help='層化サンプル件数')
parser.add_argument('--max-chars', type=int, default=1200, help='1事業あたりの入力上限文字数')
parser.add_argument('--models', default='', help='カンマ区切りでモデルを絞る')
parser.add_argument('--seed', type=int, default=42)
args = parser.parse_args()


# ── データ読み込み ──

def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    gz = Path(str(path) + '.gz')
    if gz.exists():
        return json.loads(gzip.decompress(gz.read_bytes()).decode('utf-8'))
    raise FileNotFoundError(f'{path}(.gz) が見つかりません')


def build_corpus(year: int):
    """pid -> (テキスト, policyCategory, ministry)。本文が薄い事業は除外する。"""
    scores = load_json(DATA / f'project-quality-scores-{year}.json')
    details = load_json(DATA / f'rs{year}-project-details.json')

    rows = []
    for s in scores:
        pid = str(s['pid'])
        cat = s.get('policyCategory')
        d = details.get(pid)
        if not cat or not d:
            continue
        parts = [d.get('projectName', ''), d.get('purpose', ''),
                 d.get('overview', ''), d.get('currentIssues', '')]
        text = '\n'.join(p for p in parts if p).replace('/', ' ')
        if len(text) < 80:      # 本文がほぼ無い事業は埋め込みの評価に使えない
            continue
        rows.append({
            'pid': pid,
            'text': text[:args.max_chars],
            'category': cat,
            'ministry': s.get('ministry', ''),
        })
    return rows


def stratified_sample(rows, n, seed):
    """policyCategory 別に均す。少数カテゴリが全部落ちると評価が甘くなるため。"""
    rng = np.random.default_rng(seed)
    by_cat = {}
    for r in rows:
        by_cat.setdefault(r['category'], []).append(r)
    # 1カテゴリ最低4件は確保しないと kNN/silhouette が成立しない
    cats = [c for c, v in by_cat.items() if len(v) >= 4]
    per = max(4, n // len(cats))
    out = []
    for c in sorted(cats):
        v = by_cat[c]
        idx = rng.permutation(len(v))[:per]
        out.extend(v[i] for i in idx)
    return out


# ── 埋め込み取得（キャッシュ付き） ──

def cache_path(model_id: str) -> Path:
    slug = model_id.replace('/', '__')
    return CACHE_DIR / f'{slug}.pkl'


def load_cache(model_id: str) -> dict:
    p = cache_path(model_id)
    if p.exists():
        with p.open('rb') as f:
            return pickle.load(f)
    return {}


def save_cache(model_id: str, cache: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with cache_path(model_id).open('wb') as f:
        pickle.dump(cache, f)


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:24]


def call_api(model_id: str, inputs: list[str], api_key: str, retries: int = 5):
    body = json.dumps({'model': model_id, 'input': inputs}).encode('utf-8')
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(
            API_URL, data=body,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            if 'error' in d:
                raise RuntimeError(json.dumps(d['error'], ensure_ascii=False)[:200])
            # data の order 保証は仕様上あるが、index が来ていれば従う
            items = sorted(d['data'], key=lambda x: x.get('index', 0))
            usage = d.get('usage') or {}
            return [np.asarray(i['embedding'], dtype=np.float32) for i in items], usage
        except Exception as e:  # noqa: BLE001 — レート制限も一時障害も同じ扱いで良い
            last = e
            time.sleep(min(2 ** attempt, 20))
    raise RuntimeError(f'{model_id}: {last}')


def embed_all(model: dict, texts: list[str], api_key: str):
    """未キャッシュ分だけ取りに行く。戻りは (行列, かかったコスト, 新規取得数)。"""
    model_id, batch, prefix = model['id'], model['batch'], model['prefix']
    cache = load_cache(model_id)
    payloads = [prefix + t for t in texts]
    todo = sorted({p for p in payloads if text_key(p) not in cache})

    cost = 0.0
    if todo:
        chunks = [todo[i:i + batch] for i in range(0, len(todo), batch)]
        print(f'  {model_id}: {len(todo)}件を{len(chunks)}チャンクで取得', flush=True)
        with ThreadPoolExecutor(max_workers=4) as ex:
            results = list(ex.map(lambda c: call_api(model_id, c, api_key), chunks))
        for chunk, (vecs, usage) in zip(chunks, results):
            for t, v in zip(chunk, vecs):
                cache[text_key(t)] = v
            cost += float(usage.get('cost') or 0.0)
        save_cache(model_id, cache)
    else:
        print(f'  {model_id}: 全件キャッシュヒット', flush=True)

    mat = np.vstack([cache[text_key(p)] for p in payloads]).astype(np.float32)
    return mat, cost, len(todo)


# ── 評価 ──

def l2_normalize(m: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(m, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return m / n


def knn_loo(mat: np.ndarray, labels: np.ndarray, k: int = 10, metric: str = 'cosine'):
    """leave-one-out kNN。自分自身を除いた上位k件の多数決。

    metric は必ず対象に合わせる。UMAP後の2D座標にコサインを使うと
    原点からの角度しか見ないことになり、値が壊れる（2Dは euclidean）。
    """
    from sklearn.metrics import f1_score
    if metric == 'cosine':
        x = l2_normalize(mat)
        sim = x @ x.T
    else:
        d = np.linalg.norm(mat[:, None, :] - mat[None, :, :], axis=2)
        sim = -d
    np.fill_diagonal(sim, -np.inf)
    nn = np.argsort(-sim, axis=1)[:, :k]
    pred = []
    for row in labels[nn]:
        vals, counts = np.unique(row, return_counts=True)
        pred.append(vals[np.argmax(counts)])
    pred = np.asarray(pred)
    return float((pred == labels).mean()), float(f1_score(labels, pred, average='macro'))


def evaluate(mat: np.ndarray, cats: np.ndarray, mins: np.ndarray, seed: int):
    from sklearn.cluster import KMeans
    from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score, silhouette_score
    import umap

    x = l2_normalize(mat)
    n_cat = len(np.unique(cats))

    acc, f1 = knn_loo(x, cats)
    min_acc, _ = knn_loo(x, mins)
    sil = float(silhouette_score(x, cats, metric='cosine'))

    km = KMeans(n_clusters=n_cat, random_state=seed, n_init=10).fit(x)
    ari = float(adjusted_rand_score(cats, km.labels_))
    nmi = float(normalized_mutual_info_score(cats, km.labels_))

    # 本番と同じ設定で2Dに落として、近傍が保たれるかを見る
    emb2d = umap.UMAP(n_neighbors=15, min_dist=0.1, metric='cosine',
                      random_state=seed, n_components=2).fit_transform(x)
    umap_acc, _ = knn_loo(np.asarray(emb2d, dtype=np.float32), cats, metric='euclidean')

    return {
        'knnAcc': acc,
        'knnMacroF1': f1,
        'ministryKnnAcc': min_acc,
        'silhouette': sil,
        'kmeansAri': ari,
        'kmeansNmi': nmi,
        'umapKnnAcc': umap_acc,
    }


def main():
    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        sys.exit('OPENROUTER_API_KEY が未設定です')

    rows = build_corpus(args.year)
    sample = stratified_sample(rows, args.sample, args.seed)
    texts = [r['text'] for r in sample]
    cats = np.array([r['category'] for r in sample])
    mins = np.array([r['ministry'] for r in sample])
    print(f'母集団 {len(rows)}件 → 評価サンプル {len(sample)}件 / '
          f'{len(np.unique(cats))}カテゴリ / {len(np.unique(mins))}府省庁\n')

    targets = MODELS
    if args.models:
        want = {m.strip() for m in args.models.split(',')}
        targets = [m for m in MODELS if m['id'] in want]

    results = []
    for model in targets:
        print(f'▶ {model["id"]}')
        try:
            mat, cost, fetched = embed_all(model, texts, api_key)
            metrics = evaluate(mat, cats, mins, args.seed)
        except Exception as e:  # noqa: BLE001 — 1モデル失敗で全体を落とさない
            print(f'  失敗: {e}\n')
            results.append({'model': model['id'], 'error': str(e)[:300]})
            continue
        rec = {'model': model['id'], 'dim': int(mat.shape[1]),
               'costUsd': round(cost, 6), 'fetched': fetched, **metrics}
        results.append(rec)
        print(f'  dim={rec["dim"]} knn={metrics["knnAcc"]:.3f} f1={metrics["knnMacroF1"]:.3f} '
              f'sil={metrics["silhouette"]:.3f} ari={metrics["kmeansAri"]:.3f} '
              f'umapKnn={metrics["umapKnnAcc"]:.3f} 府省庁knn={metrics["ministryKnnAcc"]:.3f} '
              f'${cost:.4f}\n', flush=True)

    ok = [r for r in results if 'error' not in r]
    ok.sort(key=lambda r: -(r['knnAcc'] + r['umapKnnAcc']) / 2)

    print('=' * 108)
    print(f'{"model":38s} {"dim":>5s} {"knn":>6s} {"macroF1":>8s} {"sil":>7s} '
          f'{"ari":>6s} {"nmi":>6s} {"umapKnn":>8s} {"省庁knn":>8s}')
    print('-' * 108)
    for r in ok:
        print(f'{r["model"]:38s} {r["dim"]:5d} {r["knnAcc"]:6.3f} {r["knnMacroF1"]:8.3f} '
              f'{r["silhouette"]:7.3f} {r["kmeansAri"]:6.3f} {r["kmeansNmi"]:6.3f} '
              f'{r["umapKnnAcc"]:8.3f} {r["ministryKnnAcc"]:8.3f}')
    for r in results:
        if 'error' in r:
            print(f'{r["model"]:38s} FAILED {r["error"][:60]}')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f'embedding-model-selection-{args.year}.json'
    out.write_text(json.dumps({
        'year': args.year,
        'sampleSize': len(sample),
        'categories': int(len(np.unique(cats))),
        'maxChars': args.max_chars,
        'seed': args.seed,
        'results': results,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n→ {out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
