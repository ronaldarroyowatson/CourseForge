import React from 'react';
import { LogoPlaceholder, PrimaryButton, RuleList, ScreenCard, SectionTitle } from '../components/common.js';
import { authorityTokens, bodyTextStyle, debugRegionStyle, stackLayoutStyle, subtleTextStyle } from '../design-system/authority-layer.js';

export function SplashScreen({ onContinue }: { onContinue: () => void }): React.JSX.Element {
  return (
    <ScreenCard title="Splash Screen">
      <SectionTitle text="Layout" />
      <div style={bodyTextStyle()}>Fullscreen centered column with logo, tagline, then primary action.</div>

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
        <PrimaryButton id="continueButton" label="Continue" onClick={onContinue} />
      </div>

      <SectionTitle text="Interaction Rules" />
      <RuleList items={["OnClick(continueButton) -> NavigateTo(AuthScreen)"]} />

      <SectionTitle text="State Rules" />
      <RuleList items={['No dynamic state', 'No conditional rendering']} />
    </ScreenCard>
  );
}
