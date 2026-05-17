import type { ReactNode } from 'react';

interface FilterRowProps {
  label: string;
  children: ReactNode;
}

export function FilterRow({ label, children }: FilterRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#555', width: 40, flexShrink: 0, fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
        {children}
      </div>
    </div>
  );
}
