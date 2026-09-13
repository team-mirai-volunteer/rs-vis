import type { ReactNode } from 'react';

interface FilterRowProps {
  label: string;
  children: ReactNode;
}

export function FilterRow({ label, children }: FilterRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-10 shrink-0 text-[11px] font-bold text-mirai-text-subtle">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {children}
      </div>
    </div>
  );
}
