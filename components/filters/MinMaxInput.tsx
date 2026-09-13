import { X } from 'lucide-react';
import { parseAmountToYen } from '@/app/lib/format/yen';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FILTER_INPUT_CLASS } from './FilterTextInput';

interface MinMaxInputProps {
  minVal: string;
  maxVal: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}

export function MinMaxInput({
  minVal,
  maxVal,
  onMinChange,
  onMaxChange,
}: MinMaxInputProps) {
  const minOk = !minVal || parseAmountToYen(minVal) !== null;
  const maxOk = !maxVal || parseAmountToYen(maxVal) !== null;
  const inputClass = (ok: boolean) =>
    cn(FILTER_INPUT_CLASS, 'flex-1', !ok && 'border-destructive focus-visible:border-destructive');

  return (
    <>
      <input
        type="text"
        value={minVal}
        onChange={(e) => onMinChange(e.target.value)}
        placeholder="下限"
        title="下限 (例: 100億, 1兆)"
        aria-invalid={!minOk || undefined}
        className={inputClass(minOk)}
      />
      <span className="text-[11px] text-mirai-text-muted">~</span>
      <input
        type="text"
        value={maxVal}
        onChange={(e) => onMaxChange(e.target.value)}
        placeholder="上限"
        title="上限 (例: 1兆, 5000億)"
        aria-invalid={!maxOk || undefined}
        className={inputClass(maxOk)}
      />
      {(minVal || maxVal) && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => { onMinChange(''); onMaxChange(''); }}
          aria-label="クリア"
          className="size-5 shrink-0 text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
        >
          <X className="size-3" />
        </Button>
      )}
    </>
  );
}
