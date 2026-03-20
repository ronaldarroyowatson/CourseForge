import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CorrectionReviewPanel } from "../../src/webapp/components/admin/CorrectionReviewPanel";
import type { CorrectionRecord } from "../../src/core/services/metadataCorrectionLearningService";

const adminMocks = vi.hoisted(() => ({
  listCorrectionsAdmin: vi.fn(),
  reviewCorrectionsAdmin: vi.fn(),
}));

vi.mock("../../src/core/services/adminFirestoreService", () => ({
  listCorrectionsAdmin: (payload: unknown) => adminMocks.listCorrectionsAdmin(payload),
  reviewCorrectionsAdmin: (payload: unknown) => adminMocks.reviewCorrectionsAdmin(payload),
}));

function sampleRecord(id: string, overrides?: Partial<CorrectionRecord>): CorrectionRecord {
  return {
    id,
    timestamp: new Date().toISOString(),
    pageType: "cover",
    publisher: "McGraw Hill",
    series: null,
    subject: "Math",
    originalVisionOutput: {
      title: "Algebra l",
      subtitle: null,
      edition: "Teacher's Edition",
      publisher: "Mc Graw Hill",
      series: null,
      gradeLevel: "8",
      subject: "Math",
      confidence: 0.4,
      rawText: "Algebra l",
      source: "vision",
    },
    originalOcrOutput: { rawText: "Algebra l" },
    finalMetadata: {
      title: "Algebra 1",
      subtitle: null,
      edition: "Teacher's Edition",
      publisher: "McGraw Hill",
      series: null,
      gradeLevel: "8",
      subject: "Math",
      confidence: 0.9,
      rawText: "Algebra 1",
      source: "vision+ocr",
    },
    imageReference: "hash://sample",
    flagged: false,
    finalConfidence: 0.9,
    errorScore: 0.5,
    reviewStatus: "pending",
    ...overrides,
  };
}

describe("CorrectionReviewPanel", () => {
  beforeEach(() => {
    adminMocks.listCorrectionsAdmin.mockReset();
    adminMocks.reviewCorrectionsAdmin.mockReset();

    adminMocks.listCorrectionsAdmin.mockResolvedValue({
      items: [sampleRecord("rec-1"), sampleRecord("rec-2", { flagged: true, reasonFlagged: "Suspicious" })],
      total: 2,
      page: 1,
      pageSize: 20,
    });

    adminMocks.reviewCorrectionsAdmin.mockResolvedValue({ updated: 2 });
  });

  it("loads, filters, and performs bulk review actions", async () => {
    render(<CorrectionReviewPanel />);

    expect(await screen.findByText("Metadata Corrections Review")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Publisher"), { target: { value: "McGraw Hill" } });
    fireEvent.change(screen.getByLabelText("Page Type"), { target: { value: "cover" } });

    await waitFor(() => {
      expect(adminMocks.listCorrectionsAdmin).toHaveBeenCalled();
    });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    fireEvent.click(screen.getByRole("button", { name: "Accept Selected" }));

    await waitFor(() => {
      expect(adminMocks.reviewCorrectionsAdmin).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "accept",
          recordIds: expect.arrayContaining(["rec-2"]),
        })
      );
    });
  });
});
