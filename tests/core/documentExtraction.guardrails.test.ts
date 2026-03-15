import { describe, expect, it } from "vitest";

import {
  analyzeDocumentQuality,
  buildExtractionPrompts,
  extractQuestionAnswerPairs,
} from "../../functions/src/documentExtraction";

describe("document extraction guardrails", () => {
  it("detects question pages followed by answer pages", () => {
    const text = `Questions\n1. What is erosion?\n2. What causes weathering?\n\nAnswers\n1. Erosion is the movement of sediment.\n2. Weathering breaks rock into smaller pieces.`;

    const pairs = extractQuestionAnswerPairs(text);

    expect(pairs).toHaveLength(2);
    expect(pairs.every((pair) => pair.layout === "split-pages")).toBe(true);
  });

  it("detects question and answer blocks when the answer is directly below the question", () => {
    const text = `1. What is the scientific method?\nAnswer: A process used to test ideas and collect evidence.\n\n2. Why do scientists repeat trials?\nAnswer: To verify that their results are consistent.`;

    const pairs = extractQuestionAnswerPairs(text);

    expect(pairs.some((pair) => pair.layout === "interleaved")).toBe(true);
    expect(pairs[0]?.answer).toContain("process used to test ideas");
  });

  it("detects inline bold answers inside a question stem", () => {
    const text = `Photosynthesis happens in the **chloroplast** of the plant cell.`;

    const pairs = extractQuestionAnswerPairs(text);

    expect(pairs).toEqual([
      {
        question: "Photosynthesis happens in the",
        answer: "chloroplast",
        layout: "inline-bold-answer",
      },
    ]);
  });

  it("flags source code uploads as blocked", () => {
    const quality = analyzeDocumentQuality({
      fileName: "lesson.txt",
      mimeType: "text/plain",
      text: `import React from \"react\";\nconst value = 2;\nfunction solve() { return value + 1; }\nexport default solve;`,
      context: { textbookSubject: "Science", chapterTitle: "The Scientific Method" },
    });

    expect(quality.accepted).toBe(false);
    expect(quality.documentType).toBe("code");
    expect(quality.issues.some((issue) => issue.code === "code_like_content")).toBe(true);
  });

  it("flags an obvious subject mismatch against the selected textbook context", () => {
    const quality = analyzeDocumentQuality({
      fileName: "worksheet.txt",
      mimeType: "text/plain",
      text: "A rusty razor can cause infection while shaving. Clean the blade, protect the skin, and avoid cuts.",
      context: {
        textbookSubject: "Physical Science",
        textbookTitle: "Physical Science with Earth Science",
        chapterTitle: "The Scientific Method",
      },
    });

    expect(quality.accepted).toBe(false);
    expect(quality.issues.some((issue) => issue.code === "subject_mismatch")).toBe(true);
  });

  it("warns when the document appears to include material from another chapter", () => {
    const quality = analyzeDocumentQuality({
      fileName: "chapter-pages.txt",
      mimeType: "text/plain",
      text: `Chapter 1: The Scientific Method\nAsk questions and test ideas.\n\nChapter 2: Plate Tectonics\nEarth's crust is broken into moving plates.`,
      context: {
        textbookSubject: "Earth Science",
        chapterTitle: "The Scientific Method",
      },
    });

    expect(quality.accepted).toBe(true);
    expect(quality.issues.some((issue) => issue.code === "multi_chapter_content")).toBe(true);
  });

  it("builds prompts that explicitly cover common worksheet layouts and anomaly detection", () => {
    const prompts = buildExtractionPrompts({
      fileName: "review.txt",
      truncatedText: "Question 1? Answer 1.",
      context: { textbookSubject: "Science", chapterTitle: "The Scientific Method" },
      quality: {
        accepted: true,
        documentType: "worksheet",
        detectedLanguage: "english",
        questionAnswerLayouts: ["interleaved"],
        issues: [],
      },
    });

    expect(prompts.systemPrompt).toContain("questions on one page and answers on a later page");
    expect(prompts.systemPrompt).toContain("answer directly below it");
    expect(prompts.systemPrompt).toContain("filled in inside the question in bold");
    expect(prompts.systemPrompt).toContain("wrong-subject uploads");
    expect(prompts.userPrompt).toContain("Subject: Science");
  });
});