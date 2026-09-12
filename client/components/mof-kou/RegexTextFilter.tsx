'use client';

/**
 * 文字列列の検索フィルタ。既定は部分一致、`.*` トグルで正規表現に切り替えられる。
 * `/sankey-svg` の事業名・支出先名フィルタ（入力欄内に`.*`トグルを埋め込む配色）を踏襲する。
 */

export interface RegexTextFilterProps {
  label: string;
  note?: string;
  value: string;
  onChange: (value: string) => void;
  useRegex: boolean;
  onToggleRegex: (useRegex: boolean) => void;
}

export function RegexTextFilter({ label, note, value, onChange, useRegex, onToggleRegex }: RegexTextFilterProps) {
  const invalid = useRegex && value !== '' && !isValidRegex(value);
  return (
    <div className="space-y-1">
      <span className="text-neutral-500" title={note}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={useRegex ? '正規表現' : '部分一致'}
            aria-label={label}
            aria-invalid={invalid}
            className={`w-full rounded border bg-white py-1 pl-2 pr-7 text-xs outline-none dark:bg-neutral-900 ${
              invalid ? 'border-red-400' : 'border-neutral-300 dark:border-neutral-700'
            }`}
          />
          <button
            type="button"
            onClick={() => onToggleRegex(!useRegex)}
            aria-pressed={useRegex}
            title={useRegex ? '正規表現をオフ' : '正規表現で絞り込み'}
            className={`absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 font-mono text-[10px] font-bold leading-none ${
              useRegex ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'
            }`}
          >
            .*
          </button>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 px-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            ×
          </button>
        )}
      </div>
      {invalid && <p className="text-[10px] text-red-500">正規表現が不正です</p>}
    </div>
  );
}

export function isValidRegex(pattern: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** 文字列フィルタのマッチ判定（正規表現が不正なときは何もマッチさせない） */
export function textMatches(haystack: string, needle: string, useRegex: boolean): boolean {
  if (!needle) return true;
  if (!useRegex) return haystack.includes(needle);
  if (!isValidRegex(needle)) return false;
  return new RegExp(needle).test(haystack);
}
