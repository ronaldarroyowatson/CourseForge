import React from 'react';
import { ScreenCard } from '../components/common.js';
import { bodyTextStyle } from '../design-system/authority-layer.js';

export function TextbookCompletedScreen(): React.JSX.Element {
  return (
    <ScreenCard title="Completed Textbook Flow Stub">
      <p style={bodyTextStyle()}>Completed flow placeholder.</p>
    </ScreenCard>
  );
}
