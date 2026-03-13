# CourseForge Agent Workflow Handoff

## Entry Point

Supervisor receives every user request and acts as control plane only: plan, route, monitor, enforce boundaries. Supervisor never writes product code or tests directly.

## Routing Order

- If read-only context is needed, route to Explorer first.
- If implementation is needed, route to Coder after Explorer returns.
- If Coder is unavailable, route to Agent Registry.
- After code changes, route to Reviewer.
- If Reviewer is unavailable, route to Reviewer Fallback.
- If tests expose UI issues, route to UIUX.
- If tests expose backend or rules issues, route to Firestore.

## Agent Boundaries

| Agent | Model | Scope | Write Paths |
| --- | --- | --- | --- |
| Supervisor | gpt-5.4 | planning, routing, monitoring | none for product code |
| Explorer | gpt-5.4-mini | read-only discovery | none |
| Coder | gpt-5.4-mini | app source | ./src |
| Reviewer | gpt-5.4-mini | validation, tests | ./tests |
| Reviewer Fallback | gpt-5.4-mini | testing only | ./tests |
| UIUX | gpt-5.4-mini | webapp UI | ./src/webapp |
| Firestore | gpt-5.4-mini | functions and rules | ./functions/src |
| Agent Registry | gpt-5.4-mini | config management | ./.copilot |

## Premium Rules

- Free models go first.
- Premium escalation requires the same free-model task to fail 3 times.
- Premium escalation always requires explicit user approval.
- Premium escalation is blocked if freezePremium is true.
- Premium escalation is blocked if daily or weekly limits are exceeded unless the user explicitly confirms continuation.
- Premium escalation is hard-blocked when monthly usage exceeds the monthly limit and freezePremium must be set true.

## Premium Usage State

- Usage file: ./.copilot/usage/premium-usage.json
- Audit log: ./.copilot/usage/escalation-audit.jsonl
- Monthly baseline: 8.6%
- Daily limit default: round(8.6 x 0.4, 1) = 3.4
- Weekly limit default: round(8.6 x 2.7, 1) = 23.2
- Monthly limit default: 100
- Daily reset: local midnight
- Weekly reset: start of local ISO week
- Monthly reset: local day 31 at 07:00
- Monthly reset fallback: local last day of month at 07:00 when no day 31 exists

## Minimal Handoff Templates

### Supervisor to Explorer

Goal: answer one narrow discovery question only.

Return:

- Files involved
- Existing pattern
- Recommended integration point
- Top risk

### Explorer to Supervisor

Question: [one sentence]

Findings:

- [fact]
- [fact]

Next best route: [coder|reviewer|uiux|firestore|agent_registry]

### Supervisor to Coder

Scope: [directory]

Requirements:

1. [requirement]
2. [requirement]

Explorer context:

- [fact]
- [fact]

Do not modify: [paths]

### Coder to Reviewer

Changed area: [feature]

Validate:

1. [test or typecheck]
2. [behavior]

Expected result: pass or specific failure report

### Escalation Gate

Check in order:

1. Has the same free-model task failed 3 times?
2. Is freezePremium false?
3. Are daily and weekly limits allowed or user-approved?
4. Is monthly limit still below hard freeze?
5. Has the user explicitly approved premium?

## Workflow Summary Requirements

Supervisor ends each workflow with:

- agent outcomes
- retries and delegations
- premiumRequestsUsedToday
- premiumRequestsUsedThisWeek
- premiumRequestsUsedThisMonth
- whether premium was used
- whether premium was frozen
- whether escalation was requested
- whether escalation was approved
- whether escalation was denied due to limits
