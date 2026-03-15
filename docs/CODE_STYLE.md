# CourseForge Code Style

This guide keeps the codebase readable by grouping related code and separating intent clearly.

## File Organization

Use this order in TypeScript files unless there is a strong reason to differ:

1. Imports
2. Exported types and interfaces
3. Internal types and constants
4. Small pure helpers
5. Main functions or React components
6. Exports (if not top-level export declarations)

Leave one blank line between each major group.

## Spacing Rules

- Keep related constants together with no blank lines between them.
- Leave one blank line between the constant block and the next function block.
- Leave one blank line between functions.
- For large functions, keep logical sub-steps separated by a single blank line.

## Naming

- Use intention-revealing names (`existingFingerprintByHash`, `normalizeForDedupe`).
- Avoid abbreviations unless they are domain-standard (`isbn`).
- Prefer nouns for values and verbs for functions.

## Comments

- Add comments only when the "why" is not obvious from the code.
- Prefer short, high-signal comments above complex logic.
- Avoid comments that simply restate the next line.

## Practical Goal

A teammate should be able to scan a file top to bottom and quickly identify:

- where constants live,
- where helper logic starts,
- where feature behavior is implemented.
