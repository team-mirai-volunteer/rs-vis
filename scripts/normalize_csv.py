#!/usr/bin/env python3
"""
RSシステム2024年度CSV正規化スクリプト

前提: data/download/RS_2024/ に手動でZIPファイルをダウンロード済み

処理フロー:
1. data/download/RS_2024/ 内のZIPファイルを解凍
2. 解凍したCSVファイルを正規化
   - neologdnによる正規化（最優先）
   - 丸数字の変換
   - Unicode NFKC正規化
   - 和暦→西暦変換
   - 全角括弧→半角括弧変換
   - ハイフン・長音の修正
   - 連続空白の削除
3. 正規化したCSVを data/year_2024/ へ出力
4. data/download/RS_2024/ 内のZIP以外のファイルを削除
"""

import os
import sys
import csv
import re
import unicodedata
import zipfile
from pathlib import Path
from typing import List

# neologdnのインポート
try:
    import neologdn
    NEOLOGDN_AVAILABLE = True
except ImportError:
    print('⚠️  neologdn がインストールされていません')
    print('   pip3 install neologdn でインストールしてください')
    NEOLOGDN_AVAILABLE = False

INPUT_DIR = Path(__file__).parent.parent / 'data' / 'download' / 'RS_2024'
OUTPUT_DIR = Path(__file__).parent.parent / 'data' / 'year_2024'

# 和暦→西暦変換マップ
ERA_TO_YEAR = {
    '令和': 2018,
    '平成': 1988,
    '昭和': 1925,
}

def convert_circled_numbers(text: str) -> str:
    """丸数字を通常数字に変換"""
    circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
    for i, char in enumerate(circled, 1):
        text = text.replace(char, str(i))
    return text

def convert_era_to_year(text: str) -> str:
    """和暦を西暦に変換"""
    for era, base_year in ERA_TO_YEAR.items():
        pattern = f'{era}(\\d+)年'
        matches = re.finditer(pattern, text)
        for match in matches:
            era_year = int(match.group(1))
            western_year = base_year + era_year
            text = text.replace(match.group(0), f'{western_year}年')
    return text

def convert_fullwidth_brackets(text: str) -> str:
    """全角括弧を半角括弧に変換"""
    text = text.replace('（', '(')
    text = text.replace('）', ')')
    return text

def fix_hyphen_to_choon(text: str) -> str:
    """ハイフン→長音の誤用修正"""
    text = re.sub(r'([ァ-ヴ])-', r'\1ー', text)
    return text

def unify_hyphens(text: str) -> str:
    """ハイフン・ダッシュを統一"""
    text = text.replace('−', '-')
    text = text.replace('－', '-')
    text = text.replace('‐', '-')
    text = text.replace('–', '-')
    text = text.replace('—', '-')
    text = text.replace('―', '-')
    return text

def fix_katakana_choon(text: str) -> str:
    """カタカナ長音記号の誤用修正"""
    text = re.sub(r'([ァ-ヴ])ー+', r'\1ー', text)
    return text

def remove_consecutive_spaces(text: str) -> str:
    """連続空白を1つに削除"""
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def normalize_text(text: str) -> str:
    """テキストの正規化処理（メイン関数）"""
    if not text:
        return text

    # 1. neologdnによる正規化（最優先）
    if NEOLOGDN_AVAILABLE:
        text = neologdn.normalize(text)

    # 2. 丸数字の変換
    text = convert_circled_numbers(text)

    # 3. Unicode NFKC正規化
    text = unicodedata.normalize('NFKC', text)

    # 4. 和暦→西暦変換
    text = convert_era_to_year(text)

    # 5. 全角括弧→半角括弧
    text = convert_fullwidth_brackets(text)

    # 6. ハイフン→長音の修正（NFKC後に実行）
    text = fix_hyphen_to_choon(text)

    # 7. ハイフン・ダッシュの統一
    text = unify_hyphens(text)

    # 8. カタカナ長音記号の誤用修正
    text = fix_katakana_choon(text)

    # 9. 連続空白の削除
    text = remove_consecutive_spaces(text)

    return text

def extract_all_zips(directory: Path) -> List[Path]:
    """ディレクトリ内のすべてのZIPファイルを解凍"""
    zip_files = list(directory.glob('*.zip'))
    extracted_files = []

    if not zip_files:
        print('⚠️  ZIPファイルが見つかりません')
        return extracted_files

    print(f'【ZIP解凍】 {len(zip_files)}個のZIPファイルを解凍中...')
    print('-' * 60)

    for zip_path in zip_files:
        try:
            print(f'📦 解凍中: {zip_path.name}')
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(directory)
                extracted_files.extend([directory / name for name in zip_ref.namelist()])
            print(f'   ✅ 完了')
        except Exception as e:
            print(f'   ❌ エラー: {e}')

    print(f'\n解凍完了: {len(extracted_files)}ファイル\n')
    return extracted_files

def normalize_csv_file(input_path: Path, output_dir: Path) -> bool:
    """CSVファイルを正規化"""
    try:
        print(f'🔧 正規化中: {input_path.name}')

        # UTF-8で読み込み（BOM対応）
        with open(input_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            rows = list(reader)

        # 各セルを正規化
        normalized_rows = []
        for row in rows:
            normalized_row = [normalize_text(cell) for cell in row]
            normalized_rows.append(normalized_row)

        # UTF-8で書き込み（BOMなし）
        output_path = output_dir / input_path.name
        with open(output_path, 'w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerows(normalized_rows)

        print(f'   ✅ 出力: {output_path.name}')
        return True

    except Exception as e:
        print(f'   ❌ エラー: {e}')
        return False

def cleanup_non_zip_files(directory: Path):
    """ZIP以外のファイルを削除"""
    print('【クリーンアップ】 ZIP以外のファイルを削除中...')
    print('-' * 60)

    deleted_count = 0
    for item in directory.iterdir():
        if item.is_file() and item.suffix.lower() != '.zip':
            try:
                print(f'🗑️  削除: {item.name}')
                item.unlink()
                deleted_count += 1
            except Exception as e:
                print(f'   ❌ 削除失敗: {e}')

    print(f'\nクリーンアップ完了: {deleted_count}ファイル削除\n')

def main():
    """メイン処理"""
    print('=' * 60)
    print('RSシステム2024年度 CSV 正規化スクリプト')
    print('=' * 60)

    if not NEOLOGDN_AVAILABLE:
        print('\n⚠️  neologdn なしで続行します（正規化品質が低下します）')
        response = input('続行しますか? (y/N): ')
        if response.lower() != 'y':
            print('中止しました')
            sys.exit(1)

    # 入力ディレクトリチェック
    if not INPUT_DIR.exists():
        print(f'❌ 入力ディレクトリが見つかりません: {INPUT_DIR}')
        print(f'   {INPUT_DIR} を作成してZIPファイルを配置してください')
        sys.exit(1)

    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f'\n入力元: {INPUT_DIR}')
    print(f'出力先: {OUTPUT_DIR}\n')

    # Phase 1: ZIP解凍
    extracted_files = extract_all_zips(INPUT_DIR)

    if not extracted_files:
        print('❌ 解凍されたファイルがありません')
        sys.exit(1)

    # Phase 2: CSV正規化
    csv_files = [f for f in INPUT_DIR.glob('*.csv')]

    if not csv_files:
        print('❌ CSVファイルが見つかりません')
        sys.exit(1)

    print(f'【CSV正規化】 {len(csv_files)}個のCSVファイルを正規化中...')
    print('-' * 60)

    success_count = 0
    for csv_path in csv_files:
        if normalize_csv_file(csv_path, OUTPUT_DIR):
            success_count += 1

    print(f'\n正規化完了: {success_count}/{len(csv_files)} ファイル\n')

    # Phase 3: クリーンアップ
    cleanup_non_zip_files(INPUT_DIR)

    print('=' * 60)
    print('すべての処理が完了しました！')
    print(f'正規化されたCSVファイル: {OUTPUT_DIR}')
    print('=' * 60)

if __name__ == '__main__':
    main()
