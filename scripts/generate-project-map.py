"""
事業の意味的2次元マップ生成（/project-map のバブルチャート用）

事業説明文を埋め込み、UMAPで2次元に落とし、高次元側でクラスタリングして、
「意味の近い事業が近くに並ぶ地図」の座標を作る。

モデル選定の根拠:
  google/gemini-embedding-001 を採用。実データ576件のベンチで全指標1位
  （kNN 0.620 / ARI 0.293 / UMAP後kNN 0.568）。再測定は
  scripts/benchmark-embedding-models.py

入力:
  public/data/rs{year}-project-details.json(.gz)          事業名・目的・概要・課題
  public/data/project-quality-scores-{year}.json(.gz)     ministry / policyCategory

出力:
  public/data/project-map-{year}.json                     座標とクラスタのみの軽量ファイル

  ministry / budgetAmount / totalScore / yearsRunning は /api/quality-scores が
  返すので、このファイルは pid・x・y・cluster しか持たない。同じ値を二重に持たない。

実行:
  OPENROUTER_API_KEY=... python3 scripts/generate-project-map.py --year 2025

  埋め込みは本文のSHA256でキャッシュ（.cache/embeddings/）。
  座標だけ引き直したい場合（UMAPやクラスタ数の調整）は再実行してもAPIコストは掛からない。
"""

import argparse
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'public' / 'data'
CACHE_DIR = ROOT / '.cache' / 'embeddings'
API_URL = 'https://openrouter.ai/api/v1/embeddings'

parser = argparse.ArgumentParser(description='事業の意味的2次元マップ生成')
parser.add_argument('--year', type=int, default=2025)
parser.add_argument('--model', default='google/gemini-embedding-001')
parser.add_argument('--batch', type=int, default=32)
parser.add_argument('--workers', type=int, default=4)
parser.add_argument('--max-chars', type=int, default=1200)
parser.add_argument('--clusters', type=int, default=30, help='KMeansのk。policyCategoryが32分類なので既定30')
parser.add_argument('--neighbors', type=int, default=25, help='UMAP n_neighbors。大きいほど大域構造を保つ')
parser.add_argument('--min-dist', type=float, default=0.15, help='UMAP min_dist。小さいほど塊が締まる')
parser.add_argument('--seed', type=int, default=42)
parser.add_argument('--limit', type=int, default=0, help='デバッグ用。先頭N件だけ処理')
args = parser.parse_args()


def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    gz = Path(str(path) + '.gz')
    if gz.exists():
        return json.loads(gzip.decompress(gz.read_bytes()).decode('utf-8'))
    raise FileNotFoundError(f'{path}(.gz) が見つかりません')


# ── 入力の組み立て ──

def build_rows(year: int):
    """埋め込み対象の行を作る。品質スコア側に存在する事業だけを扱う。

    マップは /api/quality-scores と pid で結合して使うので、
    スコアに載っていない事業を座標だけ持っていても表示できない。
    """
    scores = load_json(DATA / f'project-quality-scores-{year}.json')
    details = load_json(DATA / f'rs{year}-project-details.json')

    rows, missing = [], 0
    for s in scores:
        pid = str(s['pid'])
        d = details.get(pid)
        if not d:
            missing += 1
            continue
        parts = [
            d.get('projectName') or s.get('name') or '',
            d.get('purpose') or '',
            d.get('overview') or '',
            d.get('currentIssues') or '',
        ]
        # RSシステムの本文は箇条書きの区切りに "/" を使うので空白に開いておく
        text = '\n'.join(p for p in parts if p).replace('/', ' ').strip()
        if len(text) < 10:
            missing += 1
            continue
        rows.append({
            'pid': pid,
            'text': text[:args.max_chars],
            'name': d.get('projectName') or s.get('name') or '',
            'category': s.get('policyCategory') or 'other',
            'ministry': s.get('ministry') or '',
        })

    if missing:
        print(f'  本文が取れず除外: {missing}件')
    return rows


# ── 埋め込み（キャッシュ付き） ──

def cache_file(model_id: str) -> Path:
    return CACHE_DIR / f"{model_id.replace('/', '__')}.jsonl"


def load_cache(model_id: str) -> dict:
    """1行1レコードのJSONL。途中で落ちても書けたところまで残る。"""
    p = cache_file(model_id)
    cache = {}
    if not p.exists():
        return cache
    with p.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue    # 中断時の書きかけ行は捨てる
            cache[rec['k']] = np.asarray(rec['v'], dtype=np.float32)
    return cache


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:24]


def call_api(model_id: str, inputs: list, api_key: str, retries: int = 6):
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
            items = sorted(d['data'], key=lambda x: x.get('index', 0))
            if len(items) != len(inputs):
                raise RuntimeError(f'件数不一致 req={len(inputs)} res={len(items)}')
            usage = d.get('usage') or {}
            return [np.asarray(i['embedding'], dtype=np.float32) for i in items], usage
        except Exception as e:  # noqa: BLE001 — レート制限も一時障害も同じくリトライ
            last = e
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f'{model_id}: {last}')


def embed_all(rows, api_key: str):
    model_id = args.model
    cache = load_cache(model_id)
    texts = [r['text'] for r in rows]
    todo = sorted({t for t in texts if text_key(t) not in cache})

    print(f'  対象 {len(texts)}件 / キャッシュ済 {len(texts) - len(todo)}件 / 新規 {len(todo)}件')

    total_cost = 0.0
    if todo:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        chunks = [todo[i:i + args.batch] for i in range(0, len(todo), args.batch)]
        done = 0
        with cache_file(model_id).open('a', encoding='utf-8') as sink:
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                futures = [(c, ex.submit(call_api, model_id, c, api_key)) for c in chunks]
                for chunk, fut in futures:
                    vecs, usage = fut.result()
                    for t, v in zip(chunk, vecs):
                        cache[text_key(t)] = v
                        # 逐次フラッシュ。長時間ジョブが落ちても取得済み分を捨てない
                        sink.write(json.dumps({'k': text_key(t), 'v': [round(float(x), 6) for x in v]}) + '\n')
                    sink.flush()
                    total_cost += float(usage.get('cost') or 0.0)
                    done += len(chunk)
                    print(f'\r  埋め込み {done}/{len(todo)}  ${total_cost:.4f}', end='', flush=True)
        print()

    mat = np.vstack([cache[text_key(t)] for t in texts]).astype(np.float32)
    return mat, total_cost


# ── クラスタのラベル付け ──

TERM_RE = re.compile(r'[一-龥]{2,6}|[ァ-ヶー]{3,10}')

# どのクラスタにも出る行政文の定型語。ラベルに出しても何も分からないので落とす
STOPWORDS = {
    '事業', '実施', '推進', '必要', '対応', '整備', '支援', '実現', '確保', '向上',
    '取組', '活用', '検討', '関係', '状況', '目的', '本事業', '我が国', '以下', '場合',
    '効果', '課題', '結果', '内容', '観点', '経費', '予算', '国民', '日本', '地域',
    '重要', '適切', '促進', '強化', '構築', '提供', 'management', '実情', '当該',
}


def label_clusters(rows, labels: np.ndarray, xy: np.ndarray, mat: np.ndarray, k: int):
    """クラスタごとに、代表カテゴリ・特徴語・重心に最も近い事業を出す。

    特徴語は「そのクラスタでの出現率 ÷ 全体での出現率」で選ぶ。
    素の頻度順にすると全クラスタが同じ定型語で埋まるため。
    """
    global_df = Counter()
    per_doc_terms = []
    for r in rows:
        terms = {t for t in TERM_RE.findall(r['text']) if t not in STOPWORDS}
        per_doc_terms.append(terms)
        global_df.update(terms)

    n = len(rows)
    norm = mat / np.clip(np.linalg.norm(mat, axis=1, keepdims=True), 1e-9, None)

    clusters = []
    for cid in range(k):
        idx = np.where(labels == cid)[0]
        if len(idx) == 0:
            continue

        # 特徴語: リフト（クラスタ内出現率 / 全体出現率）。低頻度語のノイズは下限で切る
        local_df = Counter()
        for i in idx:
            local_df.update(per_doc_terms[i])
        scored = []
        for term, lc in local_df.items():
            if lc < max(3, len(idx) * 0.08):
                continue
            lift = (lc / len(idx)) / (global_df[term] / n)
            scored.append((lift, lc, term))
        scored.sort(reverse=True)
        terms = [t for _, _, t in scored[:6]]

        cats = Counter(rows[i]['category'] for i in idx)
        dom_cat, dom_n = cats.most_common(1)[0]

        # 代表事業: 高次元の重心に最も近いもの（2Dの重心だと圧縮の歪みを拾う）
        centroid = norm[idx].mean(axis=0)
        centroid /= max(float(np.linalg.norm(centroid)), 1e-9)
        rep = idx[int(np.argmax(norm[idx] @ centroid))]

        clusters.append({
            'id': int(cid),
            'count': int(len(idx)),
            # ラベルの置き場所は2D重心。円の塊の真ん中に文字が出るようにする
            'cx': round(float(xy[idx, 0].mean()), 3),
            'cy': round(float(xy[idx, 1].mean()), 3),
            'dominantCategory': dom_cat,
            'categoryShare': round(dom_n / len(idx), 3),
            'terms': terms,
            'representativePid': rows[rep]['pid'],
            'representativeName': rows[rep]['name'],
            'topMinistries': [m for m, _ in Counter(rows[i]['ministry'] for i in idx).most_common(3)],
        })
    return clusters


def main():
    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        sys.exit('OPENROUTER_API_KEY が未設定です')

    year = args.year
    print(f'[1/4] 入力を組み立て（{year}年度）')
    rows = build_rows(year)
    if args.limit:
        rows = rows[:args.limit]
    print(f'  対象事業 {len(rows)}件')

    print(f'[2/4] 埋め込み（{args.model}）')
    mat, cost = embed_all(rows, api_key)
    print(f'  {mat.shape[0]}件 × {mat.shape[1]}次元 / 追加コスト ${cost:.4f}')

    print(f'[3/4] 2次元へ圧縮（UMAP n_neighbors={args.neighbors} min_dist={args.min_dist}）')
    import umap
    from sklearn.cluster import KMeans
    from sklearn.metrics import adjusted_rand_score

    norm = mat / np.clip(np.linalg.norm(mat, axis=1, keepdims=True), 1e-9, None)
    xy = umap.UMAP(
        n_components=2, n_neighbors=args.neighbors, min_dist=args.min_dist,
        metric='cosine', random_state=args.seed,
    ).fit_transform(norm)
    xy = np.asarray(xy, dtype=np.float64)

    print(f'[4/4] クラスタリング（KMeans k={args.clusters}）')
    # クラスタは2Dではなく高次元側で切る。UMAPは局所構造を優先して
    # 大域の距離を歪めるので、2Dで切ると見た目の塊と意味の塊がずれる
    km = KMeans(n_clusters=args.clusters, random_state=args.seed, n_init=10).fit(norm)
    labels = km.labels_
    ari = adjusted_rand_score([r['category'] for r in rows], labels)
    print(f'  policyCategoryとの一致度 ARI={ari:.3f}')

    clusters = label_clusters(rows, labels, xy, mat, args.clusters)

    out = {
        'year': year,
        'model': args.model,
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'params': {
            'neighbors': args.neighbors, 'minDist': args.min_dist,
            'clusters': args.clusters, 'seed': args.seed, 'maxChars': args.max_chars,
        },
        'quality': {'kmeansAriVsPolicyCategory': round(float(ari), 4)},
        'bounds': {
            'minX': round(float(xy[:, 0].min()), 3), 'maxX': round(float(xy[:, 0].max()), 3),
            'minY': round(float(xy[:, 1].min()), 3), 'maxY': round(float(xy[:, 1].max()), 3),
        },
        'clusters': clusters,
        # 座標は小数3桁で十分（描画時にスケールするので精度は効かない）。
        # 桁を落とすとgzipもよく効く
        'points': [
            {'pid': r['pid'], 'x': round(float(xy[i, 0]), 3),
             'y': round(float(xy[i, 1]), 3), 'c': int(labels[i])}
            for i, r in enumerate(rows)
        ],
    }

    path = DATA / f'project-map-{year}.json'
    path.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    size_kb = path.stat().st_size / 1024
    print(f'\n→ {path.relative_to(ROOT)} ({size_kb:.0f}KB, {len(out["points"])}点, {len(clusters)}クラスタ)')

    print('\nクラスタ一覧:')
    for c in sorted(clusters, key=lambda c: -c['count']):
        print(f"  #{c['id']:2d} {c['count']:4d}件 {c['dominantCategory']:20s} "
              f"({c['categoryShare']:.0%}) {'/'.join(c['terms'][:4])}")

    print(f'\n圧縮: gzip -9 -k -f public/data/project-map-{year}.json')


if __name__ == '__main__':
    main()
