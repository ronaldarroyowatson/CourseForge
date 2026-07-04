import React from 'react';
import { ScreenCard } from '../components/common.js';
import { bodyTextStyle } from '../design-system/authority-layer.js';

export function TextbookResumeScreen(): React.JSX.Element {
  return (
    <ScreenCard title="Resume Extraction Flow Stub">
      <p style={bodyTextStyle()}>Resume flow placeholder.</p>
    </ScreenCard>
  );
}
