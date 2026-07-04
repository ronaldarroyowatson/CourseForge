import React from 'react';
import {
  authorityDebugRules,
  authorityTokens,
  bodyTextStyle,
  debugRegionStyle,
  flowLayoutStyle,
  headingTextStyle,
  resolvePrimitiveStyle,
  resolveReactWrapperProps,
  stackLayoutStyle,
  subtleTextStyle
} from '../design-system/authority-layer.js';

export function ScreenCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const cardStyle = resolvePrimitiveStyle('Card', 'secondary', {
    minWidth: '100%'
  });

  return (
    <section
      style={{
        ...cardStyle,
        ...stackLayoutStyle({
          gap: authorityTokens.spacing.config.lg
        }),
        ...debugRegionStyle('layoutBounds')
      }}
    >
      <h2 style={headingTextStyle('screen')}>{title}</h2>
      {children}
    </section>
  );
}

export function SectionTitle({ text }: { text: string }): React.JSX.Element {
  return (
    <strong
      style={subtleTextStyle({
        fontWeight: authorityTokens.typography.config.weight.semibold
      })}
    >
      {text}
    </strong>
  );
}

export function RuleList({ items }: { items: string[] }): React.JSX.Element {
  const listStyle = resolvePrimitiveStyle('List', 'ghost', {
    minWidth: '100%'
  });

  return (
    <ul
      style={{
        ...listStyle,
        ...stackLayoutStyle({
          gap: authorityTokens.spacing.config.sm,
          margin: 0,
          paddingLeft: authorityTokens.spacing.config.xl
        }),
        ...debugRegionStyle('layoutBounds')
      }}
    >
      {items.map((item) => (
        <li key={item} style={bodyTextStyle()}>
          {item}
        </li>
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
  const buttonProps = resolveReactWrapperProps('Button', 'primary', { disabled });

  return (
    <button
      id={id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      role={buttonProps.role}
      aria-busy={buttonProps['aria-busy']}
      aria-disabled={buttonProps['aria-disabled']}
      data-component={buttonProps['data-component']}
      data-variant={buttonProps['data-variant']}
      style={{
        ...buttonProps.style,
        ...flowLayoutStyle({
          justifyContent: 'flex-start',
          alignItems: 'center'
        }),
        fontWeight: authorityTokens.typography.config.weight.semibold
      }}
    >
      {label}
    </button>
  );
}

export function LogoPlaceholder(): React.JSX.Element {
  const panelStyle = resolvePrimitiveStyle('Panel', 'ghost', {
    minHeight: '5rem',
    minWidth: '10rem'
  });

  return (
    <div
      style={{
        ...panelStyle,
        ...flowLayoutStyle({
          alignItems: 'center',
          justifyContent: 'center'
        }),
        borderStyle: authorityDebugRules.config.borderStyle
      }}
    >
      <span style={subtleTextStyle({ fontFamily: authorityTokens.typography.config.family.mono })}>LogoPlaceholder</span>
    </div>
  );
}
