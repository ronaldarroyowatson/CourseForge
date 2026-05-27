import { beforeEach, describe, expect, it, vi } from "vitest";

const setDocMock = vi.hoisted(() => vi.fn(async () => undefined));
const docMock = vi.hoisted(() => vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })));

vi.mock("firebase/firestore", () => ({
  doc: docMock,
  setDoc: setDocMock,
}));

vi.mock("../../src/firebase/firestore", () => ({
  firestoreDb: {},
}));

import { writeTextbookMetadata } from "../../src/lib/firestore/writeTextbookMetadata";

describe("writeTextbookMetadata", () => {
  beforeEach(() => {
    setDocMock.mockClear();
    docMock.mockClear();
  });

  it("backfills userId and ownerId from uploadedBy when ownership fields are missing", async () => {
    await writeTextbookMetadata({
      textbookId: "tb-meta-1",
      title: "Chemistry",
      storagePath: "textbooks/tb-meta-1.json",
      uploadedAt: "2026-05-26T00:00:00.000Z",
      uploadedBy: "teacher-meta",
    });

    expect(docMock).toHaveBeenCalledWith({}, "textbooks", "tb-meta-1");
    expect(setDocMock).toHaveBeenCalledWith(
      { path: "textbooks/tb-meta-1" },
      expect.objectContaining({
        textbookId: "tb-meta-1",
        uploadedBy: "teacher-meta",
        userId: "teacher-meta",
        ownerId: "teacher-meta",
      })
    );
  });
});
