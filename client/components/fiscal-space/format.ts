export const money = (v: number, digits = 2) => Number.isFinite(v) ? `${(v / 1e12).toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits })}兆円` : '未定義';
export const percent = (v: number, digits = 2) => Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '未定義';
export const points = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(3)}pt`;
export const KIND_LABELS = { temporary: '一時政策', permanent: '恒久政策', growth: '成長投資' };
export const fieldClass = 'w-full rounded-xl border border-mirai-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
