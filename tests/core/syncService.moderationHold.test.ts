import { describe, expect, it } from "vitest";

import { isTextbookCloudSyncBlocked } from "../../src/core/services/syncService";

describe("syncService moderation cloud hold", () => {
  it("blocks cloud sync while admin review is pending", () => {
    const blocked = isTextbookCloudSyncBlocked({
      id: "tb-1",
      sourceType: "auto",
      title: "Grey's Anatomy",
      grade: "College",
      subject: "Science",
      edition: "1",
      publicationYear: 2026,
      isbnRaw: "",
      isbnNormalized: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      pendingSync: true,
      source: "local",
      isFavorite: false,
      isArchived: false,
      requiresAdminReview: true,
      imageModerationState: "pending_admin_review",
      status: "submitted",
      cloudSyncBlockedReason: "pending_admin_review",
    });

    expect(blocked).toBe(true);
  });

  it("allows cloud sync after admin approval", () => {
    const allowed = isTextbookCloudSyncBlocked({
      id: "tb-2",
      sourceType: "auto",
      title: "Grey's Anatomy",
      grade: "College",
      subject: "Science",
      edition: "1",
      publicationYear: 2026,
      isbnRaw: "",
      isbnNormalized: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      pendingSync: true,
      source: "local",
      isFavorite: false,
      isArchived: false,
      requiresAdminReview: true,
      imageModerationState: "clear",
      status: "approved",
    });

    expect(allowed).toBe(false);
  });
});
