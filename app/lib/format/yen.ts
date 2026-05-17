export { formatYen } from '@/app/lib/sankey-svg-constants';

function parseJapaneseNumeral(input: string): number {
  const digit: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let result = 0;
  let current = 0;
  for (const char of input) {
    if (char in digit) {
      current = digit[char];
    } else if (char === '十') {
      result += (current || 1) * 10;
      current = 0;
    } else if (char === '百') {
      result += (current || 1) * 100;
      current = 0;
    } else if (char === '千') {
      result += (current || 1) * 1000;
      current = 0;
    }
  }
  return result + current;
}

function normalizeAmountInput(input: string): string {
  let normalized = input.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xff10 + 0x30)
  );
  normalized = normalized
    .replace(/[－−‐]/g, '-')
    .replace(/[．]/g, '.')
    .replace(/[，　,\s]/g, '');
  return normalized.replace(/[一二三四五六七八九十百千]+/g, (match) =>
    String(parseJapaneseNumeral(match))
  );
}

/** "1.26億", "４５６７万円", "一千二百億", "1兆2000億", "-51000円" などを1円単位の数値に変換。解析失敗時 null */
export function parseAmountToYen(input: string): number | null {
  const normalized = normalizeAmountInput(input);
  if (!normalized) return null;

  const sign = normalized.startsWith('-') ? -1 : 1;
  const amount = sign === -1 ? normalized.slice(1) : normalized;
  const comboMatch = amount.match(/^([\d.]+)兆([\d.]+)億?$/);
  if (comboMatch) {
    const cho = parseFloat(comboMatch[1]);
    const oku = parseFloat(comboMatch[2]);
    if (!isNaN(cho) && !isNaN(oku)) return sign * (cho * 10000 + oku) * 1e8;
  }

  const unitMatch = amount.match(/^([\d.]+)\s*(兆円?|億円?|万円?|千円?|円)?$/);
  if (!unitMatch) return null;

  const value = parseFloat(unitMatch[1]);
  if (isNaN(value)) return null;

  const unit = unitMatch[2] ?? '';
  if (unit.startsWith('兆')) return sign * value * 1e12;
  if (unit.startsWith('億')) return sign * value * 1e8;
  if (unit.startsWith('万')) return sign * value * 1e4;
  if (unit.startsWith('千')) return sign * value * 1e3;
  return sign * value;
}
