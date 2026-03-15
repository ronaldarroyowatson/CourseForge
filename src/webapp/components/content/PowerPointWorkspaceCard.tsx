import React, { useEffect, useMemo, useRef, useState } from "react";

import type {
  Chapter,
  DesignSuggestions,
  ExtractedConceptEntry,
  ExtractedPresentation,
  ExtractedVocabEntry,
  PresentationSlide,
  Section,
  Textbook,
} from "../../../core/models";
import {
  exportRedesignedPresentation,
  extractPresentationFromFile,
  generateDesignSuggestions,
  isSupportedPresentationType,
  rebuildQuizSlides,
  savePresentationToLocalAndFirestore,
} from "../../../core/services/presentationService";
import {
  listChaptersByTextbookId,
  listExtractedPresentationsBySectionId,
  listSectionsByChapterId,
} from "../../../core/services/repositories";
import { useRepositories } from "../../hooks/useRepositories";

interface PowerPointWorkspaceCardProps {
  selectedTextbook: Textbook | null;
  selectedChapter: Chapter | null;
  selectedSection: Section | null;
}

type PowerPointStep = "upload" | "review" | "design" | "quiz" | "done";

interface ResolvedTarget {
  chapter: Chapter;
  section: Section;
  reason: string;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function buildSourceKey(fileName: string): string {
  const normalized = normalizeKey(fileName);
  return normalized
    .replace(/\b(v|ver|version|rev|revision|draft|final)\s*\d*\b/g, "")
    .replace(/\b\d{4}[-_]?\d{2}[-_]?\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slideSignature(slide: PresentationSlide): string {
  const text = slide.rawText.join("|").toLowerCase().replace(/\s+/g, " ").trim();
  const formulas = (slide.extractedFormulas ?? []).join("|").toLowerCase().replace(/\s+/g, " ").trim();
  const images = (slide.extractedImages ?? []).join("|").toLowerCase();
  return `${text}::${formulas}::${images}`;
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function resolveTargetFromSignals(input: {
  fileName: string;
  titleSignal?: string;
  chapters: Chapter[];
  sectionsByChapter: Map<string, Section[]>;
  selectedChapter: Chapter | null;
  selectedSection: Section | null;
}): ResolvedTarget | null {
  if (input.selectedChapter && input.selectedSection) {
    return {
      chapter: input.selectedChapter,
      section: input.selectedSection,
      reason: "Using currently selected chapter and section.",
    };
  }

  const fileKey = normalizeKey(input.fileName);
  const titleKey = input.titleSignal ? normalizeKey(input.titleSignal) : "";

  const chapterMatch = fileKey.match(/\b(?:chapter|ch)\s*[-_]?\s*(\d+)\b/i);
  const sectionMatch = fileKey.match(/\b(?:section|sec|s)\s*[-_]?\s*(\d+)\b/i);

  let best: { chapter: Chapter; section: Section; score: number } | null = null;

  for (const chapter of input.chapters) {
    if (input.selectedChapter && chapter.id !== input.selectedChapter.id) {
      continue;
    }

    const sections = input.sectionsByChapter.get(chapter.id) ?? [];
    const chapterKey = normalizeKey(chapter.name);

    for (const section of sections) {
      const sectionKey = normalizeKey(section.title);
      let score = 0;

      if (fileKey.includes(sectionKey) || sectionKey.includes(fileKey)) {
        score += 80;
      }
      if (fileKey.includes(chapterKey) || chapterKey.includes(fileKey)) {
        score += 50;
      }
      if (titleKey && (titleKey.includes(sectionKey) || sectionKey.includes(titleKey))) {
        score += 110;
      }
      if (titleKey && (titleKey.includes(chapterKey) || chapterKey.includes(titleKey))) {
        score += 65;
      }
      if (chapterMatch && Number(chapterMatch[1]) === chapter.index) {
        score += 25;
      }
      if (sectionMatch && Number(sectionMatch[1]) === section.index) {
        score += 25;
      }

      if (!best || score > best.score) {
        best = { chapter, section, score };
      }
    }
  }

  if (!best || best.score < 25) {
    return null;
  }

  return {
    chapter: best.chapter,
    section: best.section,
    reason: `Auto-matched by filename pattern (score ${best.score}).`,
  };
}

export function PowerPointWorkspaceCard({
  selectedTextbook,
  selectedChapter,
  selectedSection,
}: PowerPointWorkspaceCardProps): React.JSX.Element {
  const {
    createVocabTerm,
    createConcept,
    fetchVocabTermsBySectionId,
    fetchConceptsBySectionId,
  } = useRepositories();

  const [step, setStep] = useState<PowerPointStep>("upload");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<string[]>([]);
  const [presentation, setPresentation] = useState<ExtractedPresentation | null>(null);
  const [designSuggestions, setDesignSuggestions] = useState<DesignSuggestions | null>(null);
  const [kahootStyle, setKahootStyle] = useState(false);
  const [enableTimer, setEnableTimer] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(25);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  const quizItems = useMemo(() => {
    if (!presentation) {
      return [];
    }

    return rebuildQuizSlides(presentation.slides, {
      kahootStyle,
      enableTimer,
      timerSeconds,
    });
  }, [enableTimer, kahootStyle, presentation, timerSeconds]);

  function mergeExtractedVocab(
    baseline: ExtractedVocabEntry[] = [],
    incoming: ExtractedVocabEntry[] = []
  ): ExtractedVocabEntry[] {
    const merged = new Map<string, ExtractedVocabEntry>();

    [...baseline, ...incoming].forEach((entry) => {
      const word = entry.word?.trim();
      if (!word) {
        return;
      }

      const key = normalizeKey(word);
      const existing = merged.get(key);
      if (!existing || (!existing.definition && entry.definition)) {
        merged.set(key, {
          word,
          definition: entry.definition?.trim() || undefined,
        });
      }
    });

    return [...merged.values()];
  }

  function mergeExtractedConcepts(
    baseline: ExtractedConceptEntry[] = [],
    incoming: ExtractedConceptEntry[] = []
  ): ExtractedConceptEntry[] {
    const merged = new Map<string, ExtractedConceptEntry>();

    [...baseline, ...incoming].forEach((entry) => {
      const name = entry.name?.trim();
      if (!name) {
        return;
      }

      const key = normalizeKey(name);
      const existing = merged.get(key);
      if (!existing || (!existing.explanation && entry.explanation)) {
        merged.set(key, {
          name,
          explanation: entry.explanation?.trim() || undefined,
        });
      }
    });

    return [...merged.values()];
  }

  async function handleImportFiles(files: File[]): Promise<void> {
    const selectedFiles = files.filter(Boolean);
    if (selectedFiles.length === 0 || !selectedTextbook) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setImportReport([]);

    try {
      const chapters = await listChaptersByTextbookId(selectedTextbook.id);
      const sectionEntries = await Promise.all(
        chapters.map(async (chapter) => ({
          chapterId: chapter.id,
          sections: await listSectionsByChapterId(chapter.id),
        }))
      );

      const sectionsByChapter = new Map<string, Section[]>();
      sectionEntries.forEach((entry) => {
        sectionsByChapter.set(entry.chapterId, entry.sections);
      });

      const reportLines: string[] = [];
      let importedCount = 0;
      let duplicateCount = 0;
      let noDeltaCount = 0;
      let skippedCount = 0;
      let preview: ExtractedPresentation | null = null;
      const sectionVocabSeenById = new Map<string, Set<string>>();
      const sectionConceptSeenById = new Map<string, Set<string>>();

      async function applyStructuredSectionContent(
        sectionId: string,
        vocab: ExtractedVocabEntry[] | undefined,
        concepts: ExtractedConceptEntry[] | undefined,
        fileLabel: string
      ): Promise<void> {
        if (!sectionVocabSeenById.has(sectionId)) {
          const existingVocab = await fetchVocabTermsBySectionId(sectionId);
          sectionVocabSeenById.set(sectionId, new Set(existingVocab.map((entry) => normalizeKey(entry.word))));
        }

        if (!sectionConceptSeenById.has(sectionId)) {
          const existingConcepts = await fetchConceptsBySectionId(sectionId);
          sectionConceptSeenById.set(sectionId, new Set(existingConcepts.map((entry) => normalizeKey(entry.name))));
        }

        const vocabSeen = sectionVocabSeenById.get(sectionId) as Set<string>;
        const conceptSeen = sectionConceptSeenById.get(sectionId) as Set<string>;

        const newVocab = (vocab ?? [])
          .map((entry) => ({ word: entry.word.trim(), definition: entry.definition?.trim() || undefined }))
          .filter((entry) => entry.word.length > 0)
          .filter((entry) => {
            const key = normalizeKey(entry.word);
            if (vocabSeen.has(key)) {
              return false;
            }
            vocabSeen.add(key);
            return true;
          });

        const newConcepts = (concepts ?? [])
          .map((entry) => ({ name: entry.name.trim(), explanation: entry.explanation?.trim() || undefined }))
          .filter((entry) => entry.name.length > 0)
          .filter((entry) => {
            const key = normalizeKey(entry.name);
            if (conceptSeen.has(key)) {
              return false;
            }
            conceptSeen.add(key);
            return true;
          });

        await Promise.all([
          ...newVocab.map((entry) => createVocabTerm({
            sectionId,
            word: entry.word,
            definition: entry.definition,
          })),
          ...newConcepts.map((entry) => createConcept({
            sectionId,
            name: entry.name,
            explanation: entry.explanation,
          })),
        ]);

        if (newVocab.length > 0 || newConcepts.length > 0) {
          reportLines.push(`${fileLabel}: captured ${newVocab.length} vocab and ${newConcepts.length} concepts from slide content.`);
        }
      }

      for (const file of selectedFiles) {
        if (!isSupportedPresentationType(file)) {
          skippedCount += 1;
          reportLines.push(`${file.name}: skipped (unsupported type).`);
          continue;
        }

        setImportStatusMessage(
          file.name.toLowerCase().endsWith(".ppt")
            ? `Converting ${file.name} from .ppt to .pptx...`
            : `Extracting ${file.name}...`
        );

        const extracted = await extractPresentationFromFile(file, {
          textbook: selectedTextbook,
        });

        const target = resolveTargetFromSignals({
          fileName: file.name,
          titleSignal: extracted.inferredSectionTitle ?? extracted.presentationTitle,
          chapters,
          sectionsByChapter,
          selectedChapter,
          selectedSection,
        });

        if (!target) {
          skippedCount += 1;
          reportLines.push(`${file.name}: skipped (could not auto-match chapter/section from filename or title slide).`);
          continue;
        }

        const fileHash = await computeFileHash(file);
        const existingInSection = await listExtractedPresentationsBySectionId(target.section.id);

        if (existingInSection.some((row) => row.fileHash && row.fileHash === fileHash)) {
          duplicateCount += 1;
          reportLines.push(`${file.name}: skipped (exact duplicate already imported for this section).`);
          continue;
        }

        const extractedWithTarget: ExtractedPresentation = {
          ...extracted,
          textbookId: selectedTextbook.id,
          chapterId: target.chapter.id,
          sectionId: target.section.id,
          inferredChapterTitle: extracted.inferredChapterTitle ?? target.chapter.name,
          inferredSectionTitle: extracted.inferredSectionTitle ?? target.section.title,
        };

        const sourceKey = buildSourceKey(file.name);
        const existingBySource = existingInSection.find(
          (row) => (row.sourceKey && row.sourceKey === sourceKey) || buildSourceKey(row.fileName) === sourceKey
        );

        if (existingBySource) {
          const existingSignatures = new Set(existingBySource.slides.map((slide: PresentationSlide) => slideSignature(slide)));
          const newSlides = extractedWithTarget.slides.filter((slide: PresentationSlide) => !existingSignatures.has(slideSignature(slide)));

          if (newSlides.length === 0) {
            noDeltaCount += 1;
            reportLines.push(`${file.name}: no new slide material found; existing deck unchanged.`);
            continue;
          }

          const merged: ExtractedPresentation = {
            ...existingBySource,
            fileName: extractedWithTarget.fileName,
            fileHash,
            sourceKey,
            slides: [...existingBySource.slides, ...newSlides],
            designSuggestions: extractedWithTarget.designSuggestions ?? existingBySource.designSuggestions,
            inferredChapterTitle: extractedWithTarget.inferredChapterTitle,
            inferredSectionTitle: extractedWithTarget.inferredSectionTitle,
            extractedVocab: mergeExtractedVocab(existingBySource.extractedVocab, extractedWithTarget.extractedVocab),
            extractedConcepts: mergeExtractedConcepts(existingBySource.extractedConcepts, extractedWithTarget.extractedConcepts),
            updatedAt: new Date().toISOString(),
            pendingSync: true,
            source: "local",
          };

          await savePresentationToLocalAndFirestore(merged);
          await applyStructuredSectionContent(target.section.id, merged.extractedVocab, merged.extractedConcepts, file.name);
          importedCount += 1;
          reportLines.push(
            `${file.name}: merged into ${target.chapter.name} -> ${target.section.title} (+${newSlides.length} new slide(s)). ${target.reason}`
          );
          if (!preview) {
            preview = merged;
          }
          continue;
        }

        const toSave: ExtractedPresentation = {
          ...extractedWithTarget,
          fileHash,
          sourceKey,
        };

        await savePresentationToLocalAndFirestore(toSave);
        await applyStructuredSectionContent(target.section.id, toSave.extractedVocab, toSave.extractedConcepts, file.name);
        importedCount += 1;
        reportLines.push(`${file.name}: imported to ${target.chapter.name} -> ${target.section.title}. ${target.reason}`);
        if (!preview) {
          preview = toSave;
        }
      }

      setImportReport(reportLines);
      if (preview) {
        setPresentation(preview);
        setDesignSuggestions(preview.designSuggestions ?? null);
        setStep("review");
      }

      setSuccessMessage(
        `Import complete: ${importedCount} saved, ${duplicateCount} duplicates skipped, ${noDeltaCount} with no new material, ${skippedCount} unmatched/unsupported.`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not import these presentations.");
    } finally {
      setImportStatusMessage(null);
      setIsBusy(false);
    }
  }

  async function handleInputSelect(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await handleImportFiles(files);
  }

  async function handleRefreshSuggestions(): Promise<void> {
    if (!presentation) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      const suggestions = await generateDesignSuggestions({
        presentationTitle: presentation.presentationTitle,
        slides: presentation.slides,
      });
      setDesignSuggestions(suggestions);
      setStep("design");
    } catch {
      setErrorMessage("Unable to refresh design suggestions right now.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!presentation) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      const toSave: ExtractedPresentation = {
        ...presentation,
        designSuggestions: designSuggestions ?? presentation.designSuggestions,
      };

      await savePresentationToLocalAndFirestore(toSave);
      setSuccessMessage("PowerPoint content saved to Firestore and local workspace.");
      setStep("done");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save presentation.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExport(): Promise<void> {
    if (!presentation || !designSuggestions) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      await exportRedesignedPresentation({
        presentation,
        quizItems,
        designSuggestions,
      });
      setSuccessMessage("Redesigned .pptx exported successfully.");
    } catch {
      setErrorMessage("Export failed. Please try again.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!selectedTextbook) {
    return (
      <section className="panel">
        <h3>PowerPoints</h3>
        <p>Select a textbook before importing PowerPoints.</p>
      </section>
    );
  }

  return (
    <section className="panel powerpoint-card">
      <h3>PowerPoints</h3>
      <p>
        Import and sanitize .ppt/.pptx files, review extracted slides, apply AI design suggestions,
        rebuild quizzes, and export a redesigned deck.
      </p>

      <div className="powerpoint-meta">
        <span>Textbook: {selectedTextbook.title}</span>
        <span>Chapter: {selectedChapter?.name ?? "Auto-match by filename"}</span>
        <span>Section: {selectedSection?.title ?? "Auto-match by filename"}</span>
      </div>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {successMessage ? <p className="sync-indicator sync-indicator--synced">{successMessage}</p> : null}
      {importStatusMessage ? <p>{importStatusMessage}</p> : null}
      {importReport.length > 0 ? (
        <ul className="textbook-list">
          {importReport.map((line) => (
            <li key={line} className="textbook-row">
              <p>{line}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {step === "upload" ? (
        <div className="powerpoint-upload">
          <div
            className="ingest-dropzone"
            role="button"
            tabIndex={0}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleImportFiles(Array.from(event.dataTransfer.files ?? []));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drag and drop PowerPoint files"
          >
            <strong>Drop .ppt/.pptx files here</strong>
            <p className="ingest-layout-summary">Supports single or batch import. Duplicate files are skipped automatically.</p>
          </div>

          <div className="cover-input-row">
            <button type="button" className="cover-file-label ingest-picker-button" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </button>
            <button type="button" className="cover-file-label ingest-picker-button" onClick={() => folderInputRef.current?.click()}>
              Scan Folder
            </button>
          </div>

          <label className="cover-file-label cover-file-label-hidden">
            Browse Files
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="cover-file-input"
              onChange={(event) => void handleInputSelect(event)}
              aria-label="Browse PowerPoint Files"
              disabled={isBusy}
            />
          </label>
          <label className="cover-file-label cover-file-label-hidden">
            Scan Folder
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="cover-file-input"
              onChange={(event) => void handleInputSelect(event)}
              aria-label="Scan PowerPoint Folder"
              disabled={isBusy}
            />
          </label>
          <p className="ingest-layout-summary">Decorative frames, clipart, and broken animation artifacts are filtered during extraction.</p>
        </div>
      ) : null}

      {presentation && step !== "upload" ? (
        <>
          <section className="powerpoint-review-grid">
            <article className="panel">
              <h4>Slides ({presentation.slides.length})</h4>
              <ul className="textbook-list">
                {presentation.slides.map((slide: PresentationSlide) => (
                  <li key={slide.id} className="textbook-row">
                    <div>
                      <strong>
                        Slide {slide.index}: {slide.type}
                      </strong>
                      <p>{slide.rawText.slice(0, 2).join(" ") || "No text found"}</p>
                      {slide.extractedFormulas && slide.extractedFormulas.length > 0 ? (
                        <p className="section-content-counts">Formulas: {slide.extractedFormulas.join(" | ")}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            <article className="panel">
              <h4>Design Suggestions Preview</h4>
              {designSuggestions ? (
                <>
                  <p><strong>Theme:</strong> {designSuggestions.themeName}</p>
                  <p><strong>Fonts:</strong> {designSuggestions.fontChoices.join(", ")}</p>
                  <p><strong>Animation:</strong> {designSuggestions.animationStyle}</p>
                  <p><strong>Backgrounds:</strong> {designSuggestions.backgroundAssets.length}</p>
                  <p><strong>Video loops:</strong> {designSuggestions.videoBackgroundSuggestions?.length ?? 0}</p>
                </>
              ) : (
                <p>No suggestions loaded.</p>
              )}

              <div className="nav-button-row">
                <button type="button" onClick={() => void handleRefreshSuggestions()} disabled={isBusy}>
                  Refresh AI Suggestions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("quiz");
                  }}
                  disabled={isBusy}
                >
                  Continue to Quiz Rebuild
                </button>
              </div>
            </article>
          </section>

          {step === "quiz" || step === "done" ? (
            <section className="panel">
              <h4>Quiz Rebuild</h4>
              <div className="nav-button-row">
                <label>
                  <input
                    type="checkbox"
                    checked={kahootStyle}
                    onChange={(event) => setKahootStyle(event.target.checked)}
                    disabled={isBusy}
                  />
                  Use Kahoot-like style
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={enableTimer}
                    onChange={(event) => setEnableTimer(event.target.checked)}
                    disabled={isBusy}
                  />
                  Enable timer
                </label>
                <label>
                  Timer (seconds)
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={timerSeconds}
                    onChange={(event) => setTimerSeconds(Number(event.target.value) || 25)}
                    disabled={isBusy || !enableTimer}
                  />
                </label>
              </div>

              {quizItems.length === 0 ? (
                <p>No quiz question/answer slide pairs were detected.</p>
              ) : (
                <ul className="textbook-list">
                  {quizItems.map((item) => (
                    <li key={item.id} className="textbook-row">
                      <div>
                        <strong>{item.question}</strong>
                        <p>Answer: {item.answer}</p>
                        <p className="section-content-counts">Choices: {item.choices.join(" | ")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="nav-button-row">
                <button type="button" onClick={() => void handleSave()} disabled={isBusy}>
                  Save to Firestore
                </button>
                <button type="button" onClick={() => void handleExport()} disabled={isBusy || !designSuggestions}>
                  Export Redesigned .pptx
                </button>
              </div>
            </section>
          ) : null}

          {step === "review" ? (
            <div className="nav-button-row">
              <button type="button" onClick={() => setStep("design")}>
                Open Theme Suggestions
              </button>
              <button type="button" onClick={() => setStep("upload")}>Import Another File</button>
            </div>
          ) : null}
        </>
      ) : null}

      {isBusy ? <p>Working...</p> : null}
    </section>
  );
}
