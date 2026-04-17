# CourseForge Copilot Policy

## Bugfix Workflow (Mandatory)

1. **Start with a failing test.**
   - Every bug must begin with a minimal failing test that reproduces the issue.

2. **Confirm the test fails for the correct reason.**
   - Ensure failure matches the bug, not setup issues.

3. **Fix the code only after the failing test exists.**
   - No patches without tests.

4. **Expand coverage with edge cases.**
   - Add tests for common variants, misconfigurations, and edge inputs.

5. **Add to regression suite + update docs.**
   - Ensure CI runs the new tests.
   - Update DSC debug docs if needed.
   - Add changelog entry.

Agents must refuse to fix bugs without following this workflow.
