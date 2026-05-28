# macOS Release Authority Checklist

This laptop is the source of truth for final releases.

## Before Parallel Build Dispatch

1. Ensure branch is up to date.
2. Ensure bugfix code and docs are committed or intentionally staged.
3. Ensure `gh auth status` is valid.

## Dispatch Parallel Artifact Build

```bash
npm run orchestrate:installers -- --description "<release description>" --ref <branch>
```

## Validate Returned Artifacts

1. Confirm both jobs succeeded in GitHub Actions.
2. Confirm artifact version matches `package.json` version.
3. Confirm checksums exist for each platform artifact.
4. Confirm Windows and macOS verification logs show success.

## Final Release Steps (Only Here)

1. Run `npm run bugfix:test`.
2. Run release workflow command appropriate for current OS constraints.
3. Create/push final commit and tag from this device.
4. Publish release from this device.

## Notes

- If Windows packaging is unavailable on this device, keep Windows artifact generation in workflow or work-PC agent path.
- Keep version bump/tag generation single-owner to prevent collisions.
