import React from 'react';

export function ScreenCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section style={{ border: '1px solid #d1d1d1', borderRadius: '8px', padding: '16px', display: 'grid', gap: '12px' }}>
      <h2 style={{ margin: 0, fontSize: '20px' }}>{title}</h2>
      {children}
    </section>
  );
}

export function SectionTitle({ text }: { text: string }): React.JSX.Element {
  return <strong style={{ fontSize: '14px' }}>{text}</strong>;
}

export function RuleList({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul style={{ margin: 0, paddingLeft: '18px', display: 'grid', gap: '6px' }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PrimaryButton({
  id,
  label,
  disabled = false,
  onClick
}: {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: '1px solid #a8a8a8',
        borderRadius: '6px',
        background: '#ffffff',
        padding: '12px',
        textAlign: 'left',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {label}
    </button>
  );
}

export function LogoPlaceholder(): React.JSX.Element {
  return (
    <div
      style={{
        width: '160px',
        height: '80px',
        border: '1px dashed #b0b0b0',
        borderRadius: '6px',
        display: 'grid',
        placeItems: 'center'
      }}
    >
      LogoPlaceholder
    </div>
  );
}
