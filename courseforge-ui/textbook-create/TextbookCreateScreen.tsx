import React from 'react';
import { RuleList, ScreenCard, SectionTitle } from '../components/common.js';

export function TextbookCreateScreen(): React.JSX.Element {
  return (
    <ScreenCard title="Create Textbook Flow Stub">
      <SectionTitle text="Ownership Verification Rules" />
      <RuleList
        items={[
          'Require teacher cover image upload',
          'Compute pHash from cover image',
          'Store coverImageHash in textbooks/{id}',
          'Use coverImageHash to verify edition ownership before sharing'
        ]}
      />

      <SectionTitle text="Sharing Safety Rules" />
      <RuleList
        items={[
          'Only share teacher-created content',
          'Never share copyrighted textbook pages',
          'Structural metadata such as chapter titles and section names is allowed'
        ]}
      />
    </ScreenCard>
  );
}
