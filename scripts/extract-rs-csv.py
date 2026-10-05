"""RSシステムのCSV ZIP（data/download/RS_{年度}/）を data/year_{年度}/ に UTF-8 CSV として展開する。

使用法: python scripts/extract-rs-csv.py <RS年度>
ZIP内CSVは UTF-8(BOM) または Shift_JIS。文字コードを判定して UTF-8（BOM無し）で書き出す。
ヘッダの括弧は全角のまま残す（読み取り側 scripts/csv-reader.ts が NFKC で吸収する）。
"""
import io, sys, zipfile
from pathlib import Path

# Windows のコンソール（cp932）でも ✅ などを出力できるようにする
sys.stdout.reconfigure(encoding='utf-8')


def entry_name(info: zipfile.ZipInfo) -> str:
    """ZIP 内のファイル名。UTF-8 フラグの無い名前は Python が cp437 として読むので、Shift_JIS として読み直す"""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode('cp437').decode('cp932')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename

year = sys.argv[1] if len(sys.argv) > 1 else None
if not year or not year.isdigit():
    print('使用法: python scripts/extract-rs-csv.py <RS年度>'); sys.exit(1)
src = Path('data/download') / f'RS_{year}'
dst = Path('data') / f'year_{year}'
dst.mkdir(parents=True, exist_ok=True)
zips = sorted(src.glob('*.zip'))
if not zips:
    print(f'{src} に ZIP がありません'); sys.exit(1)
for z in zips:
    with zipfile.ZipFile(z) as zf:
        csvs = [i for i in zf.infolist() if entry_name(i).lower().endswith('.csv')]
        for info in zf.infolist():
            name = entry_name(info)
            if not name.lower().endswith('.csv'):
                continue
            raw = zf.read(info)
            for enc in ('utf-8-sig', 'cp932'):
                try:
                    text = raw.decode(enc); break
                except UnicodeDecodeError:
                    text = None
            if text is None:
                print(f'  ❌ {name}: 文字コード判定失敗'); continue
            # Shift_JIS の2バイト目が 0x5C（\）の文字（「予」など）は ZIP 読み込みで区切り文字として扱われ名前が切れるので、
            # CSV が1つだけの ZIP は ZIP 自体の名前（ダウンロード時の正しい日本語名）を使う
            out = dst / (f'{z.stem}.csv' if len(csvs) == 1 else Path(name).name)
            out.write_text(text, encoding='utf-8', newline='')
            print(f'  ✅ {out.name} ({len(raw)/1024/1024:.1f} MB, {enc})')
