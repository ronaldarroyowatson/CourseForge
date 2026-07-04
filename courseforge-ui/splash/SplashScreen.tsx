import React from 'react';
import { LogoPlaceholder, RuleList, ScreenCard, SectionTitle } from '../components/common.js';
import { authorityTokens, bodyTextStyle, debugRegionStyle, stackLayoutStyle, subtleTextStyle } from '../design-system/authority-layer.js';

export function SplashScreen(): React.JSX.Element {
  return (
    <ScreenCard title="Splash Screen">
      <SectionTitle text="Layout" />
      <div style={bodyTextStyle()}>Fullscreen centered column with logo, tagline, and Otto-managed progress.</div>

      <SectionTitle text="Components" />
      <div
        style={{
          ...stackLayoutStyle({
            gap: authorityTokens.spacing.config.md,
            alignItems: 'center',
            textAlign: 'center'
          }),
          ...debugRegionStyle('layoutBounds')
        }}
      >
        <LogoPlaceholder />
        <div style={subtleTextStyle()}>TaglineText: Build your course data safely and privately.</div>
      </div>

      <SectionTitle text="Interaction Rules" />
      <RuleList items={['No manual action required', 'Otto update completion routes automatically to Auth or Workspace']} />

      <SectionTitle text="State Rules" />
      <RuleList items={['Displays while Otto lifecycle is not OTTO_DONE', 'Hides after Otto fade-out handoff']} />
    </ScreenCard>
  );
}
