import "fake-indexeddb/auto";

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtractedDocumentData } from "../../src/core/services/documentIngestService";
import type { Chapter, Section, Textbook } from "../../src/core/models";
import { initDB, STORE_NAMES } from "../../src/core/services/db";
import {
  listConceptsBySectionId,
  listEquationsBySectionId,
  listKeyIdeasBySectionId,
  listVocabTermsBySectionId,
  saveChapter,
  saveSection,
  saveTextbook,
} from "../../src/core/services/repositories";
import { DocumentIngestPanel } from "../../src/webapp/components/content/DocumentIngestPanel";

const documentIngestMocks = vi.hoisted(() => ({
  extractFromDocuments: vi.fn<(_: File[]) => Promise<ExtractedDocumentData>>(),
  isSupportedDocumentType: vi.fn(() => true),
  generateTieredQuestionBankFromSeedItems: vi.fn(),
}));

vi.mock("../../src/core/services/documentIngestService", () => ({
  extractFromDocuments: documentIngestMocks.extractFromDocuments,
  isSupportedDocumentType: documentIngestMocks.isSupportedDocumentType,
  generateTieredQuestionBankFromSeedItems: documentIngestMocks.generateTieredQuestionBankFromSeedItems,
}));

async function clearDatabase(): Promise<void> {
  const db = await initDB();
  const storeNames = Object.values(STORE_NAMES);
  const tx = db.transaction(storeNames, "readwrite");

  await Promise.all(storeNames.map((storeName) => tx.objectStore(storeName).clear()));
  await tx.done;
}

function buildTextbook(id: string): Textbook {
  return {
    id,
    sourceType: "manual",
    originalLanguage: "en",
    title: "World History",
    grade: "9",
    subject: "History",
    edition: "2026",
    publicationYear: 2026,
    isbnRaw: "978-1-23456-789-0",
    isbnNormalized: "9781234567890",
    createdAt: "2026-03-14T00:00:00.000Z",
    updatedAt: "2026-03-14T00:00:00.000Z",
    lastModified: "2026-03-14T00:00:00.000Z",
    pendingSync: false,
    source: "local",
    isFavorite: false,
    isArchived: false,
  };
}

function buildChapter(id: string, textbookId: string): Chapter {
  return {
    id,
    sourceType: "manual",
    textbookId,
    index: 1,
    name: "Industrial Revolution",
    lastModified: "2026-03-14T00:00:00.000Z",
    pendingSync: false,
    source: "local",
  };
}

function buildSection(id: string, textbookId: string, chapterId: string): Section {
  return {
    id,
    sourceType: "manual",
    textbookId,
    chapterId,
    index: 1,
    title: "Steam Power",
    lastModified: "2026-03-14T00:00:00.000Z",
    pendingSync: false,
    source: "local",
  };
}

describe("DocumentIngestPanel", () => {
  beforeEach(async () => {
    await clearDatabase();
    documentIngestMocks.extractFromDocuments.mockReset();
    documentIngestMocks.isSupportedDocumentType.mockReset();
    documentIngestMocks.isSupportedDocumentType.mockReturnValue(true);
    documentIngestMocks.generateTieredQuestionBankFromSeedItems.mockReset();
    documentIngestMocks.generateTieredQuestionBankFromSeedItems.mockResolvedValue({
      level1: [],
      level2: [],
      level3: [],
      all: [],
    });
    window.localStorage.removeItem("courseforge:ingest:alwaysSkipAiMaterials");
  });

  it("ingests extracted data, lets the teacher review it, and persists pending-sync records into IndexedDB", async () => {
    const textbookId = "tb-ingest-1";
    const chapterId = "ch-ingest-1";
    const sectionId = "sec-ingest-1";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, textbookId, chapterId));

    documentIngestMocks.extractFromDocuments.mockResolvedValue({
      vocab: ["spinning jenny", "steam engine"],
      concepts: ["industrialization"],
      equations: ["work = force * distance"],
      namesAndDates: [{ name: "James Watt", date: "1769" }],
      keyIdeas: ["Steam power accelerated factory production."],
      quality: {
        accepted: true,
        documentType: "worksheet",
        detectedLanguage: "english",
        questionAnswerLayouts: ["interleaved"],
        issues: [],
      },
    });

    const onDone = vi.fn();
    render(
      <DocumentIngestPanel
        selectedSectionId={sectionId}
        extractionContext={{ textbookSubject: "History", chapterTitle: "Industrial Revolution" }}
        onDone={onDone}
      />
    );

    const input = screen.getByLabelText("Browse Files") as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["Steam engines changed manufacturing."], "steam-power.txt", { type: "text/plain" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Review and edit the extracted items/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Vocab Terms (2)")).toBeInTheDocument();
    expect(screen.getByText("Concepts (1)")).toBeInTheDocument();
    expect(screen.getByText("Equations (1)")).toBeInTheDocument();
    expect(screen.getByText("Names & Dates (1)")).toBeInTheDocument();
    expect(screen.getByText(/Detected worksheet layout: interleaved/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("spinning jenny")).toBeInTheDocument();
    expect(screen.getByDisplayValue("James Watt")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("steam engine"), {
      target: { value: "steam engine (refined)" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save to Section" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved \d+ new item\(s\) to this section\./i)).toBeInTheDocument();
    }, { timeout: 5000 });

    const [vocabTerms, concepts, equations, keyIdeas] = await Promise.all([
      listVocabTermsBySectionId(sectionId),
      listConceptsBySectionId(sectionId),
      listEquationsBySectionId(sectionId),
      listKeyIdeasBySectionId(sectionId),
    ]);

    expect(vocabTerms).toHaveLength(2);
    expect(vocabTerms.map((term) => term.word).sort()).toEqual([
      "spinning jenny",
      "steam engine (refined)",
    ]);
    expect(vocabTerms.every((term) => term.pendingSync && term.source === "local")).toBe(true);
    expect(vocabTerms.every((term) => term.textbookId === textbookId && term.chapterId === chapterId)).toBe(true);

    expect(concepts).toHaveLength(1);
    expect(concepts[0]?.name).toBe("industrialization");
    expect(concepts[0]?.pendingSync).toBe(true);
    expect(concepts[0]?.textbookId).toBe(textbookId);
    expect(concepts[0]?.chapterId).toBe(chapterId);

    expect(equations).toHaveLength(1);
    expect(equations[0]?.latex).toBe("work = force \\cdot distance");
    expect(equations[0]?.name).toBe("work = force \\cdot distance");
    expect(equations[0]?.pendingSync).toBe(true);

    expect(keyIdeas).toHaveLength(2);
    expect(keyIdeas.map((item) => item.text).sort()).toEqual([
      "James Watt (1769)",
      "Steam power accelerated factory production.",
    ]);
    expect(keyIdeas.every((item) => item.pendingSync && item.source === "local")).toBe(true);
  });

  it("blocks saving when extraction diagnostics mark the file as unrelated or unsafe", async () => {
    const textbookId = "tb-ingest-2";
    const chapterId = "ch-ingest-2";
    const sectionId = "sec-ingest-2";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, textbookId, chapterId));

    documentIngestMocks.extractFromDocuments.mockResolvedValue({
      vocab: [],
      concepts: [],
      equations: [],
      namesAndDates: [],
      keyIdeas: [],
      quality: {
        accepted: false,
        documentType: "reference",
        detectedLanguage: "english",
        questionAnswerLayouts: [],
        issues: [
          {
            code: "subject_mismatch",
            severity: "error",
            message: "The uploaded content appears unrelated to the selected textbook or chapter context.",
          },
        ],
      },
    });

    render(<DocumentIngestPanel selectedSectionId={sectionId} onDone={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Browse Files"), {
      target: {
        files: [new File(["Rusty razors and shaving safety"], "wrong-topic.txt", { type: "text/plain" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Import blocked/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save to Section" })).toBeDisabled();
    expect(screen.getByText(/appears unrelated to the selected textbook or chapter context/i)).toBeInTheDocument();
  });

  it("supports drag-drop and merged review for multiple files", async () => {
    const textbookId = "tb-ingest-3";
    const chapterId = "ch-ingest-3";
    const sectionId = "sec-ingest-3";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, textbookId, chapterId));

    documentIngestMocks.extractFromDocuments.mockResolvedValue({
      vocab: ["erosion", "weathering"],
      concepts: ["surface processes"],
      equations: [],
      namesAndDates: [],
      keyIdeas: ["Weathering breaks rock apart before erosion moves it."],
      quality: {
        accepted: true,
        documentType: "lesson",
        detectedLanguage: "english",
        questionAnswerLayouts: ["split-pages"],
        issues: [],
      },
    });

    render(<DocumentIngestPanel selectedSectionId={sectionId} onDone={vi.fn()} />);

    const dropzone = screen.getByRole("button", { name: /drag and drop documents here or browse for files/i });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(["Questions"], "worksheet-1.txt", { type: "text/plain" }),
          new File(["Answers"], "worksheet-2.txt", { type: "text/plain" }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/Processed 2 file\(s\): worksheet-1.txt, worksheet-2.txt\./i)).toBeInTheDocument();
    });

    expect(documentIngestMocks.extractFromDocuments).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Detected worksheet layout: split-pages/i)).toBeInTheDocument();
  });

  it("detects existing Level 1-only items and adds missing Level 2/3 AI variants when enabled", async () => {
    const textbookId = "tb-ingest-4";
    const chapterId = "ch-ingest-4";
    const sectionId = "sec-ingest-4";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, textbookId, chapterId));

    const { saveVocabTerm } = await import("../../src/core/services/repositories");
    await saveVocabTerm({
      id: "vocab-base-1",
      textbookId,
      chapterId,
      sectionId,
      word: "momentum",
      definition: "Mass in motion.",
      difficultyLevel: 1,
      isOriginal: true,
      variationOf: null,
      lastModified: "2026-03-14T00:00:00.000Z",
      pendingSync: false,
      source: "local",
    });

    documentIngestMocks.extractFromDocuments.mockResolvedValue({
      vocab: ["inertia"],
      concepts: [],
      equations: [],
      namesAndDates: [],
      keyIdeas: [],
      vocabWithDefinitions: [{ word: "inertia", definition: "Resistance to change in motion." }],
      quality: {
        accepted: true,
        documentType: "lesson",
        detectedLanguage: "english",
        questionAnswerLayouts: [],
        issues: [],
      },
      tieredQuestionBank: {
        level1: [],
        level2: [],
        level3: [],
        all: [],
      },
    });

    documentIngestMocks.generateTieredQuestionBankFromSeedItems.mockResolvedValue({
      level1: [],
      level2: [
        {
          id: "vocab-base-1:l2:1",
          baseItemId: "vocab-base-1",
          contentType: "vocab",
          question: "Which statement best explains momentum?",
          correctAnswer: "Mass in motion.",
          distractors: ["Mass at rest.", "Heat transfer.", "Electrical charge."],
          difficultyLevel: 2,
          isOriginal: false,
          variationOf: "vocab-base-1:l1",
          sourceMetadata: {
            sourceType: "document-ingest",
            originalFilename: "physics.txt",
            variationAllowed: true,
          },
        },
      ],
      level3: [
        {
          id: "vocab-base-1:l3:1",
          baseItemId: "vocab-base-1",
          contentType: "vocab",
          question: "Which option is NOT a valid momentum interpretation?",
          correctAnswer: "Mass in motion.",
          distractors: ["Momentum depends on velocity.", "Momentum is a vector.", "Momentum is conserved."],
          difficultyLevel: 3,
          isOriginal: false,
          variationOf: "vocab-base-1:l1",
          sourceMetadata: {
            sourceType: "document-ingest",
            originalFilename: "physics.txt",
            variationAllowed: true,
          },
        },
      ],
      all: [
        {
          id: "vocab-base-1:l2:1",
          baseItemId: "vocab-base-1",
          contentType: "vocab",
          question: "Which statement best explains momentum?",
          correctAnswer: "Mass in motion.",
          distractors: ["Mass at rest.", "Heat transfer.", "Electrical charge."],
          difficultyLevel: 2,
          isOriginal: false,
          variationOf: "vocab-base-1:l1",
          sourceMetadata: {
            sourceType: "document-ingest",
            originalFilename: "physics.txt",
            variationAllowed: true,
          },
        },
        {
          id: "vocab-base-1:l3:1",
          baseItemId: "vocab-base-1",
          contentType: "vocab",
          question: "Which option is NOT a valid momentum interpretation?",
          correctAnswer: "Mass in motion.",
          distractors: ["Momentum depends on velocity.", "Momentum is a vector.", "Momentum is conserved."],
          difficultyLevel: 3,
          isOriginal: false,
          variationOf: "vocab-base-1:l1",
          sourceMetadata: {
            sourceType: "document-ingest",
            originalFilename: "physics.txt",
            variationAllowed: true,
          },
        },
      ],
    });

    render(<DocumentIngestPanel selectedSectionId={sectionId} onDone={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Browse Files"), {
      target: {
        files: [new File(["Momentum notes"], "physics.txt", { type: "text/plain" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/missing Level 2\/3 AI variants/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save to Section" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved \d+ new item\(s\) to this section\./i)).toBeInTheDocument();
    }, { timeout: 5000 });

    const vocabTerms = await listVocabTermsBySectionId(sectionId);
    expect(vocabTerms.some((item) => item.variationOf === "vocab-base-1" && item.difficultyLevel === 2)).toBe(true);
    expect(vocabTerms.some((item) => item.variationOf === "vocab-base-1" && item.difficultyLevel === 3)).toBe(true);
  });

  it("respects always-skip AI materials preference", async () => {
    const textbookId = "tb-ingest-5";
    const chapterId = "ch-ingest-5";
    const sectionId = "sec-ingest-5";

    await saveTextbook(buildTextbook(textbookId));
    await saveChapter(buildChapter(chapterId, textbookId));
    await saveSection(buildSection(sectionId, textbookId, chapterId));

    documentIngestMocks.extractFromDocuments.mockResolvedValue({
      vocab: ["velocity"],
      concepts: [],
      equations: [],
      namesAndDates: [],
      keyIdeas: [],
      vocabWithDefinitions: [{ word: "velocity", definition: "Speed with direction." }],
      quality: {
        accepted: true,
        documentType: "lesson",
        detectedLanguage: "english",
        questionAnswerLayouts: [],
        issues: [],
      },
      tieredQuestionBank: {
        level1: [],
        level2: [],
        level3: [],
        all: [],
      },
    });

    render(<DocumentIngestPanel selectedSectionId={sectionId} onDone={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Browse Files"), {
      target: {
        files: [new File(["Velocity notes"], "velocity.txt", { type: "text/plain" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/AI Harder-Material Options/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Always skip AI-generated materials/i));
    fireEvent.click(screen.getByRole("button", { name: "Save to Section" }));

    await waitFor(() => {
      expect(screen.getByText(/Saved \d+ new item\(s\) to this section\./i)).toBeInTheDocument();
    }, { timeout: 5000 });

    expect(documentIngestMocks.generateTieredQuestionBankFromSeedItems).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("courseforge:ingest:alwaysSkipAiMaterials")).toBe("1");
  });
});