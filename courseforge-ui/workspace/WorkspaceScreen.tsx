import React from 'react';
import { PrimaryButton, RuleList, ScreenCard, SectionTitle } from '../components/common.js';
import { authorityTokens, bodyTextStyle, debugRegionStyle, stackLayoutStyle } from '../design-system/authority-layer.js';

export function WorkspaceScreen({
  userName,
  avatarLabel,
  hasInProgressTextbooks,
  hasCompletedTextbooks,
  hasVerifiedTextbooks,
  hasSharedContentAvailable
}: {
  userName: string;
  avatarLabel: string;
  hasInProgressTextbooks: boolean;
  hasCompletedTextbooks: boolean;
  hasVerifiedTextbooks: boolean;
  hasSharedContentAvailable: boolean;
}): React.JSX.Element {
  return (
    <ScreenCard title="Workspace Screen">
      <SectionTitle text="Layout" />
      <div style={bodyTextStyle()}>Fullscreen workspace with header and three large teacher-facing action buttons.</div>

      <SectionTitle text="Components" />
      <div
        style={{
          ...stackLayoutStyle({
            gap: authorityTokens.spacing.config.md
          }),
          ...debugRegionStyle('layoutBounds')
        }}
      >
        <div style={bodyTextStyle()}>WorkspaceHeader: UserAvatar({avatarLabel}) + UserName({userName})</div>
        <PrimaryButton id="newTextbook" label="Add New Textbook" />
        <PrimaryButton id="resumeTextbook" label="Resume Extraction" disabled={!hasInProgressTextbooks} />
        <PrimaryButton id="openCompleted" label="Open Completed Textbook" disabled={!hasCompletedTextbooks} />
      </div>

      <SectionTitle text="Interaction Rules" />
      <RuleList
        items={[
          'OnClick(newTextbook) -> NavigateTo(CreateTextbookFlow)',
          'OnClick(resumeTextbook) -> NavigateTo(ResumeFlow) when enabled',
          'OnClick(openCompleted) -> NavigateTo(CompletedFlow) when enabled'
        ]}
      />

      <SectionTitle text="State Rules" />
      <RuleList
        items={[
          'Query textbooks where ownerId = uid',
          `hasInProgressTextbooks=${String(hasInProgressTextbooks)}`,
          `hasCompletedTextbooks=${String(hasCompletedTextbooks)}`,
          `ownershipVerificationStatus=${hasVerifiedTextbooks ? 'verified' : 'pending'}`,
          `sharedContentAvailability=${hasSharedContentAvailable ? 'available' : 'requires edition verification'}`
        ]}
      />

      <SectionTitle text="Conditional Rendering" />
      <RuleList items={['Buttons remain visible in all states', 'For new users: Resume/Open Completed are disabled']} />
    </ScreenCard>
  );
}
