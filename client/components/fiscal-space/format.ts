const rounded = (v: number, digits: number) => Number(v.toFixed(digits)) || 0;
export const money = (v: number, digits = 2) => Number.isFinite(v) ? `${rounded(v / 1e12, digits).toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits })}兆円` : '未定義';
export const percent = (v: number, digits = 2) => Number.isFinite(v) ? `${rounded(v * 100, digits).toFixed(digits)}%` : '未定義';
export const points = (v: number) => {
  const rounded = Number((v * 100).toFixed(3));
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(3)}ポイント`;
};
export const KIND_LABELS = { temporary: '一時政策', permanent: '恒久政策', growth: '成長投資' };
export const fieldClass = 'w-full rounded-xl border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
