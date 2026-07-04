import React from 'react';
import { RuleList, ScreenCard, SectionTitle } from '../components/common.js';
import { bodyTextStyle } from '../design-system/authority-layer.js';

export function TextbookCreateScreen(): React.JSX.Element {
  return (
    <ScreenCard title="Create Textbook Flow (pHash Ownership Verification)">
      <p style={bodyTextStyle()}>All textbook and ownership commands remain routed through CSL-backed service calls.</p>
      <SectionTitle text="Ownership Verification Rules" />
      <RuleList
        items={[
          'Require teacher cover image upload before textbook creation',
          'Convert cover image to grayscale and canonical dimensions for pHash generation',
          'Store coverImageHash via Otto DB extension commands only',
          'Write ownershipVerification/{ownerId:textbookId} with verificationMethod=pHash',
          'Mark textbook verification status as verified after command success'
        ]}
      />

      <SectionTitle text="Shared Content Access Flow" />
      <RuleList
        items={[
          'Query edition owners with pHash Hamming distance tolerance (<= 10 default)',
          'Allow access only when requester edition matches textbook edition',
          'Filter out any references that appear to be copyrighted textbook material',
          'Allow only teacher-created content and structural metadata references'
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

      <SectionTitle text="Current Status" />
      <RuleList
        items={[
          'Verification status: pHash flow active (Otto DB extension)',
          'Shared content availability: gated by same-edition ownership checks'
        ]}
      />
    </ScreenCard>
  );
}
