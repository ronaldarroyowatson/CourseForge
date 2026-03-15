import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { persistAutoTextbook } from "../../src/core/services/autoTextbookPersistenceService";
import type { TocChapter } from "../../src/core/services/textbookAutoExtractionService";
import { TextbookForm } from "../../src/webapp/components/textbooks/TextbookForm";
import { useUIStore } from "../../src/webapp/store/uiStore";

const repositoryMocks = vi.hoisted(() => ({
  createTextbook: vi.fn<(input: any) => Promise<string>>(async () => "textbook-1"),
  editTextbook: vi.fn<(id: string, changes: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({ id: "textbook-1" })),
  findTextbookByISBN: vi.fn<(isbn: string) => Promise<undefined>>(async () => undefined),
  createChapter: vi.fn<(input: { textbookId: string; index: number; name: string; description?: string }) => Promise<string>>(async ({ index }) => `chapter-${index}`),
  createSection: vi.fn<(input: { chapterId: string; index: number; title: string; notes?: string }) => Promise<string>>(async () => "section-1"),
}));

vi.mock("../../src/webapp/hooks/useRepositories", () => ({
  useRepositories: () => ({
    createTextbook: repositoryMocks.createTextbook,
    editTextbook: repositoryMocks.editTextbook,
    findTextbookByISBN: repositoryMocks.findTextbookByISBN,
    createChapter: repositoryMocks.createChapter,
    createSection: repositoryMocks.createSection,
  }),
}));

describe("auto textbook flow integration", () => {
  beforeEach(() => {
    repositoryMocks.createTextbook.mockClear();
    repositoryMocks.editTextbook.mockClear();
    repositoryMocks.findTextbookByISBN.mockClear();
    repositoryMocks.createChapter.mockClear();
    repositoryMocks.createSection.mockClear();

    useUIStore.setState({
      selectedTextbook: null,
      selectedTextbookId: null,
    });
  });

  it("switches from Auto setup back to Manual entry", () => {
    render(<TextbookForm onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Auto \(from screenshots\)/i }));

    expect(screen.getByRole("button", { name: "Switch to Manual" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual" }));

    expect(screen.getByRole("button", { name: "Save Textbook" })).toBeInTheDocument();
  });

  it("persists textbook, chapters, and sections while only storing cover image data", async () => {
    const toc: TocChapter[] = [
      {
        chapterNumber: "1",
        title: "Integers",
        sections: [
          { sectionNumber: "1.1", title: "Absolute Value" },
          { sectionNumber: "1.2", title: "Number Lines" },
        ],
      },
      {
        chapterNumber: "2",
        title: "Expressions",
        sections: [{ sectionNumber: "2.1", title: "Variables" }],
      },
    ];

    await persistAutoTextbook(
      {
        metadata: {
          title: "Foundations of Algebra",
          grade: "8",
          gradeBand: "7-9",
          subject: "Math",
          edition: "3rd Edition",
          publicationYear: 2026,
          isbnRaw: "978-1-4028-9462-6",
          tocExtractionConfidence: 0.84,
        },
        coverDataUrl: "data:image/jpeg;base64,AAAA",
        tocChapters: toc,
      },
      {
        createTextbook: repositoryMocks.createTextbook,
        createChapter: repositoryMocks.createChapter,
        createSection: repositoryMocks.createSection,
      }
    );

    expect(repositoryMocks.createTextbook).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.createTextbook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Foundations of Algebra",
        coverDataUrl: "data:image/jpeg;base64,AAAA",
      })
    );

    const firstCreateCall = repositoryMocks.createTextbook.mock.calls.at(0);
    expect(firstCreateCall).toBeDefined();
    const savedTextbookPayload = (firstCreateCall?.[0] ?? {}) as Record<string, unknown>;
    expect(savedTextbookPayload).not.toHaveProperty("titlePageImageUrl");
    expect(savedTextbookPayload).not.toHaveProperty("tocPageImages");
    expect(savedTextbookPayload).not.toHaveProperty("rawOcrText");

    expect(repositoryMocks.createChapter).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.createSection).toHaveBeenCalledTimes(3);
  });

  it("blocks explicit language in Auto OCR parsing", () => {
    render(<TextbookForm onSaved={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /Auto \(from screenshots\)/i }));

    const ocrInput = screen.getByLabelText(/OCR text/i);
    fireEvent.change(ocrInput, { target: { value: "This is fucking explicit text" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Metadata Extraction" }));

    expect(screen.getByText(/Capture blocked: detected inappropriate language/i)).toBeInTheDocument();
  });
});
