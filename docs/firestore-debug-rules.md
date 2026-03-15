# CourseForge – Firestore Ruleset for Debug Log Protection

> **Related docs:** [Developer Onboarding](./developer-onboarding.md) · [Auto Mode Pipeline](./auto-mode-flowchart.md) · [Architecture](./ARCHITECTURE.md)

---

## Overview

Debug logs are uploaded to Firestore at:

```text
/debugReports/{userId}/reports/{reportId}
```

Client-side writes to this path are **always denied** — the path is write-protected. All writes are performed exclusively by the `uploadDebugLogReport` Cloud Function using the Firebase Admin SDK, after server-side validation of:

- Authentication (caller must be signed in and `userId` must match `request.auth.uid`)
- Payload size (max `maxUploadBytes`, default 512 KB; configurable up to 2 MB by admin)
- Policy gate (`enabledGlobally` flag and per-user `disabledUserIds` list)

This design means Firestore rules serve as a belt-and-suspenders protection layer; the primary enforcement is in the Cloud Function.

---

## 1. Live Ruleset (from `firestore.rules`)

The rules below are already deployed in the codebase at `firestore.rules`:

```javascript
// =========================================================================
// /debugReports/{userId}/reports/{reportId}
//
// Debug logs are written only by privileged callable functions (Admin SDK)
// after server-side payload validation and size enforcement.
// =========================================================================
match /debugReports/{userId} {
  allow read:  if isSignedIn() && (request.auth.uid == userId || isAdmin());
  allow write: if false;

  match /reports/{reportId} {
    allow read:  if isSignedIn() && (request.auth.uid == userId || isAdmin());
    allow write: if false;
  }
}
```

**What this enforces:**

| Operation | Authenticated user (own data) | Admin | Unauthenticated |
| --- | --- | --- | --- |
| Read `/debugReports/{own uid}` | ✅ | ✅ | ❌ |
| Read `/debugReports/{other uid}` | ❌ | ✅ | ❌ |
| Read `/debugReports/{uid}/reports/{id}` | ✅ (own) | ✅ | ❌ |
| Write anything under `/debugReports/` | ❌ | ❌ | ❌ |

The unconditional `allow write: if false` at every level means **no client**, including an admin browser session, can write debug reports directly. Only the Firebase Admin SDK (used by Cloud Functions) bypasses Firestore security rules entirely.

---

## 2. Helper Functions Used

The rules above use two helper functions defined at the top of `firestore.rules`:

### `isSignedIn()`

```javascript
function isSignedIn() {
  return request.auth != null;
}
```

Returns `true` when the request carries a valid Firebase Auth session token.

### `isAdmin()`

```javascript
function isAdmin() {
  return request.auth != null
    && 'admin' in request.auth.token
    && request.auth.token.admin == true;
}
```

Returns `true` when the caller holds the custom `admin` JWT claim. This claim is set exclusively by the `setUserAdminStatus` Cloud Function and is **never writable from the client**.

---

## 3. Additional Helper Examples

These helpers are not in the current ruleset but illustrate patterns for extension if the rules are expanded in the future.

### `isValidDebugPath(userId)`

Validates that the path userId segment matches the authenticated caller:

```javascript
function isValidDebugPath(userId) {
  return isSignedIn() && request.auth.uid == userId;
}
```

Usage:

```javascript
match /debugReports/{userId}/reports/{reportId} {
  allow read: if isValidDebugPath(userId) || isAdmin();
  allow write: if false; // enforced by Cloud Function only
}
```

### `isBelowSizeLimit(resource)`

> **Note:** Firestore rules do **not** expose `request.resource.size` in bytes as a document-level byte count. Size enforcement is handled in the Cloud Function before the Admin SDK write. This helper shows the conceptual pattern.

```javascript
// Conceptual only — Firestore rules measure field count, not raw bytes.
// Real byte-size enforcement is done in uploadDebugLogReport Cloud Function.
function isBelowSizeLimit() {
  // Limit write to a maximum field count as a proxy guard
  return request.resource.data.keys().size() <= 5;
}
```

For authoritative size enforcement, see the `uploadDebugLogReport` function in `functions/src/index.ts`, which checks `serializedSize <= policy.maxUploadBytes` before calling `admin.firestore().collection(...).add(...)`.

---

## 4. Server-Side Enforcement (Cloud Functions)

The `uploadDebugLogReport` callable function enforces the following before writing:

```typescript
// functions/src/index.ts

// 1. Auth check
if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");

// 2. userId match
if (request.auth.uid !== data.userId)
  throw new HttpsError("permission-denied", "userId mismatch.");

// 3. Policy gate
const policy = await getDebugLoggingPolicyRecord();
if (!policy.enabledGlobally)
  throw new HttpsError("failed-precondition", "Debug logging disabled globally.");
if (policy.disabledUserIds.includes(request.auth.uid))
  throw new HttpsError("failed-precondition", "Debug logging disabled for this user.");

// 4. Size check
const entries = sanitizeDebugLogEntries(data.entries ?? []);
const serialized = JSON.stringify(entries);
if (serialized.length > policy.maxUploadBytes)
  throw new HttpsError("invalid-argument", "Payload exceeds maxUploadBytes.");

// 5. Write via Admin SDK (bypasses Firestore security rules server-side)
await admin.firestore()
  .collection(`debugReports/${data.userId}/reports`)
  .add({ ... });
```

Configured limits (from `DEFAULT_DEBUG_POLICY` in `functions/src/index.ts`):

| Setting | Default | Min | Max |
| --- | --- | --- | --- |
| `maxUploadBytes` | 512 KB | 64 KB | 2 MB |
| `maxLocalLogBytes` | 1.5 MB | 256 KB | 4 MB |

Admins can update these via the `setDebugLoggingPolicy` callable (available in `AdminToolsPage → Debug Logging` tab).

---

## 5. Testing Rules Locally

### Prerequisites

- Firebase CLI (`npm install -g firebase-tools`)
- Java 11+ (required by the Firestore emulator)

### Start the emulator

```bash
firebase emulators:start --only firestore
```

The emulator UI is available at `http://localhost:4000`.

### Run rule tests

```bash
npm run test:rules
```

This runs `tests/rules/firestore.rules.test.ts` against the emulator. The test file:

1. Bootstraps an isolated test environment with `initializeTestEnvironment`.
2. Creates authenticated contexts for an owner user, a different user, and an unauthenticated context.
3. Asserts `assertSucceeds` / `assertFails` for each operation.

**Example test for debug report protection:**

```typescript
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { setDoc, getDoc, doc } from "firebase/firestore";

it("denies direct client write to debug report", async () => {
  const env = await initializeTestEnvironment({ projectId: "test-cf" });
  const ownerCtx = env.authenticatedContext("user-123");
  const db = ownerCtx.firestore();

  await assertFails(
    setDoc(doc(db, "debugReports/user-123/reports/test-report"), {
      entries: [],
      uploadedAt: Date.now(),
    })
  );
});

it("allows owner to read their own debug reports", async () => {
  const env = await initializeTestEnvironment({ projectId: "test-cf" });
  const ownerCtx = env.authenticatedContext("user-123");
  const otherCtx = env.authenticatedContext("user-456");
  const db = ownerCtx.firestore();

  // Use admin context to seed a document
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "debugReports/user-123/reports/r1"), {
      entries: [],
    });
  });

  // Owner can read
  await assertSucceeds(getDoc(doc(db, "debugReports/user-123/reports/r1")));

  // Other user cannot read
  await assertFails(
    getDoc(doc(otherCtx.firestore(), "debugReports/user-123/reports/r1"))
  );
});
```

---

## 6. Deploying Rules

### Deploy rules only (no functions)

```bash
firebase deploy --only firestore:rules
```

### Deploy rules + Cloud Functions together

```bash
firebase deploy --only firestore:rules,functions
```

### Verify deployed rules

After deploying, visually inspect rules in the Firebase Console:
**Firebase Console → Firestore → Rules**

Or fetch them via the CLI:

```bash
firebase firestore:rules:get
```

---

## 7. Updating Rules Safely

Follow these steps when modifying `firestore.rules`:

1. **Write a test first** in `tests/rules/firestore.rules.test.ts` that covers the new or changed path.
2. **Run locally** with `npm run test:rules` to confirm your new test fails (red).
3. **Update the rule** in `firestore.rules`.
4. **Re-run tests** to confirm the new test passes and all existing tests still pass.
5. **Deploy to staging** (if a staging project exists) before deploying to production.
6. **Deploy**: `firebase deploy --only firestore:rules`.
7. **Verify** in the Firebase Console that the new rules are active.

> **Warning:** Never delete or loosen a `allow write: if false` rule on `/debugReports/` without a corresponding Cloud Function enforcement replacement. Doing so would allow unauthenticated or cross-user writes.

---

## 8. Catch-All Deny

`firestore.rules` includes a catch-all at the bottom of the `match /databases/{database}/documents` block:

```javascript
match /{document=**} {
  allow read:  if false;
  allow write: if false;
}
```

Any path not explicitly matched — including new collections accidentally created outside the schema — is denied by default. This provides defense-in-depth against configuration drift.
