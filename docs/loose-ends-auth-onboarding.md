# Loose Ends - Auth and Onboarding

Last updated: 2026-05-30

This document tracks open auth-provider setup items and end-to-end onboarding validations that still need to be completed.

## 1) Auth provider setup status

- [x] Google provider enabled in Firebase
- [x] GitHub provider enabled in Firebase (owner reported complete)
- [x] Microsoft provider enabled in Firebase (owner reported complete)
- [ ] Apple provider enabled in Firebase
  - Blocker: Apple Developer paid account not yet available.
  - Deferred until paid account is active.

## 2) Provider auth handoff validation matrix

Goal: prove each enabled provider reaches its external sign-in page and returns to app flow correctly.

- [ ] Google: click provider from login and verify external auth page handoff
- [ ] GitHub: click provider from login and verify external auth page handoff
- [ ] Microsoft: click provider from login and verify external auth page handoff
- [ ] Apple: deferred until provider can be enabled

Return-path checks for each successful provider:

- [ ] Sign-in mode: user returns authenticated to textbooks/workspace route
- [ ] Link mode from settings: user returns to settings
- [ ] Linked provider appears as connected in account card

## 3) Local-only onboarding and persistence

Goal: ensure local-first workflow is reliable before cloud linking.

### Test scenario A: Start local-only account

- [ ] Start a local-only account using a fake teacher identity
  - Suggested identity: "Teacher Local QA"
- [ ] Confirm auth mode is local and cloud providers are not auto-linked

### Test scenario B: Create textbook in local-only mode

- [ ] Create a textbook end-to-end in local-only mode
- [ ] Confirm textbook appears immediately in local workspace list
- [ ] Refresh/reopen app and confirm textbook is recalled from local storage

## 4) Local-to-cloud migration flow

Goal: ensure data transfer works cleanly when a local-only user later links cloud auth.

### Test scenario C: Link cloud provider after local creation

- [ ] From local-only state with existing local textbook data, add cloud account (Google/GitHub/Microsoft)
- [ ] Confirm migration metadata is written and local session transitions to cloud session
- [ ] Confirm previously local textbook data is available after cloud sign-in
- [ ] Confirm no duplicate textbook artifacts are created by migration

## 5) Duplicate textbook detection and ownership flow

Goal: block duplicate onboarding and direct user to ownership/selection flow.

### Test scenario D: Duplicate textbook submission

- [ ] Attempt to add the same textbook twice during onboarding
- [ ] Verify system detects duplicate and halts new duplicate creation path
- [ ] Verify user is informed clearly that textbook already exists
- [ ] Verify ownership verification flow is shown/required as designed
- [ ] Verify final action favors using/downloading existing textbook, not creating a second copy

## 6) Suggested evidence to capture for each scenario

- [ ] Screenshot of critical UI checkpoints
- [ ] Relevant debug-log entries (auth redirect + onboarding)
- [ ] Final expected state summary (pass/fail and observed behavior)

## 7) Follow-up automation targets

Add or extend automated tests after manual confirmation:

- [ ] Integration test: local-only -> cloud link migration preserves textbook data
- [ ] Integration test: duplicate textbook detection interrupts onboarding and routes to existing textbook path
- [ ] Integration test: provider link mode returns user to settings and updates connected methods

## 8) Related docs

- Testing standards: docs/TESTING_AND_DEBUG_STANDARDS.md
- Setup checklist: docs/courseforge-setup-checklist.md
- Architecture reference: docs/ARCHITECTURE.md
