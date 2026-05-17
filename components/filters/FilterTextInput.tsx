interface FilterTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function FilterTextInput({ value, onChange, placeholder }: FilterTextInputProps) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          fontSize: 12,
          border: '1px solid #ddd',
          borderRadius: 4,
          padding: '3px 22px 3px 6px',
          background: '#fafafa',
          color: '#333',
          outline: 'none',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="クリア"
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#bbb', cursor: 'pointer', padding: 2, fontSize: 11 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
