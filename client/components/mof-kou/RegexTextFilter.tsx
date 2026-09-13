'use client';

/**
 * 文字列列の検索フィルタ。既定は部分一致、`.*` トグルで正規表現に切り替えられる。
 * `/sankey-svg` の事業名・支出先名フィルタ（入力欄内に`.*`トグルを埋め込む配色）を踏襲する。
 */

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
      <span className="font-medium text-mirai-text-subtle" title={note}>
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
            className={cn(
              'w-full rounded-md border bg-card py-1 pl-2 pr-7 text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary',
              invalid ? 'border-destructive focus-visible:border-destructive' : 'border-mirai-border'
            )}
          />
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onToggleRegex(!useRegex)}
            aria-pressed={useRegex}
            title={useRegex ? '正規表現をオフ' : '正規表現で絞り込み'}
            className={cn(
              'absolute right-1 top-1/2 h-auto -translate-y-1/2 rounded-md px-1 py-0.5 font-mono text-[10px] font-bold leading-none',
              useRegex
                ? 'bg-primary text-white hover:bg-primary hover:text-white'
                : 'text-mirai-text-muted hover:bg-transparent hover:text-mirai-text-subtle'
            )}
          >
            .*
          </Button>
        </div>
        {value && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange('')}
            aria-label="クリア"
            className="size-5 shrink-0 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
      {invalid && <p className="text-[10px] text-destructive">正規表現が不正です</p>}
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
