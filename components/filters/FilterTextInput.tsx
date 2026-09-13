import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FilterTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** フィルタ欄の共通 input クラス（MinMaxInput / MultiSelectDropdown と揃える） */
export const FILTER_INPUT_CLASS =
  'w-full min-w-0 rounded-md border border-mirai-border bg-card px-1.5 py-[3px] text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary';

export function FilterTextInput({ value, onChange, placeholder }: FilterTextInputProps) {
  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${FILTER_INPUT_CLASS} pr-6`}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange('')}
          aria-label="クリア"
          className="absolute right-0.5 top-1/2 size-5 -translate-y-1/2 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
