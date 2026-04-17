import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  uploadBytes: vi.fn(),
  getDownloadURL: vi.fn(async () => "https://example.invalid/cover.jpg"),
}));

vi.mock("../../src/firebase/storage", () => ({
  firebaseStorage: {},
}));

vi.mock("firebase/storage", () => ({
  ref: storageMocks.ref,
  uploadBytes: storageMocks.uploadBytes,
  getDownloadURL: storageMocks.getDownloadURL,
}));

import {
  uploadTextbookCoverFromDataUrl,
  uploadTextbookCoverImage,
} from "../../src/core/services/coverImageService";

describe("coverImageService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storageMocks.ref.mockClear();
    storageMocks.uploadBytes.mockClear();
    storageMocks.getDownloadURL.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uploads a file with fallback content type when file.type is empty", async () => {
    storageMocks.uploadBytes.mockResolvedValue({ ref: { fullPath: "textbookCovers/tb-1" } });
    const file = new File(["bytes"], "cover.bin", { type: "" });

    await expect(uploadTextbookCoverImage("tb-1", file)).resolves.toBe("https://example.invalid/cover.jpg");

    expect(storageMocks.ref).toHaveBeenCalledWith({}, "textbookCovers/tb-1");
    expect(storageMocks.uploadBytes).toHaveBeenCalledTimes(1);
    expect(storageMocks.uploadBytes.mock.calls[0][2]).toEqual({ contentType: "image/jpeg" });
  });

  it("uploads data URL as blob with parsed MIME type", async () => {
    storageMocks.uploadBytes.mockResolvedValue({ ref: { fullPath: "textbookCovers/tb-2" } });
    const dataUrl = "data:image/png;base64,SGVsbG8=";

    await expect(uploadTextbookCoverFromDataUrl("tb-2", dataUrl)).resolves.toBe("https://example.invalid/cover.jpg");

    const uploadedBlob = storageMocks.uploadBytes.mock.calls[0][1] as Blob;
    const uploadOptions = storageMocks.uploadBytes.mock.calls[0][2] as { contentType: string };

    expect(uploadedBlob).toBeInstanceOf(Blob);
    expect(uploadedBlob.type).toBe("image/png");
    expect(uploadOptions.contentType).toBe("image/png");
  });

  it("rejects when upload times out", async () => {
    vi.useFakeTimers();
    storageMocks.uploadBytes.mockReturnValue(new Promise(() => undefined));
    const file = new File(["bytes"], "cover.png", { type: "image/png" });

    const pending = uploadTextbookCoverImage("tb-timeout", file);
    const assertion = expect(pending).rejects.toThrow("Cover image upload timed out after 15000ms.");
    await vi.advanceTimersByTimeAsync(15_001);

    await assertion;
  });

  it("propagates upload failures", async () => {
    storageMocks.uploadBytes.mockRejectedValue(new Error("permission denied"));
    const file = new File(["bytes"], "cover.png", { type: "image/png" });

    await expect(uploadTextbookCoverImage("tb-err", file)).rejects.toThrow("permission denied");
  });

  it("defaults data URL MIME type to image/png when header is malformed", async () => {
    storageMocks.uploadBytes.mockResolvedValue({ ref: { fullPath: "textbookCovers/tb-3" } });

    await uploadTextbookCoverFromDataUrl("tb-3", "invalid,SGVsbG8=");

    const uploadedBlob = storageMocks.uploadBytes.mock.calls[0][1] as Blob;
    expect(uploadedBlob.type).toBe("image/png");
  });
});
