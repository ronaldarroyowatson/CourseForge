import React, { useMemo, useState } from "react";

import type {
  Chapter,
  DesignSuggestions,
  ExtractedPresentation,
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

interface PowerPointWorkspaceCardProps {
  selectedTextbook: Textbook | null;
  selectedChapter: Chapter | null;
  selectedSection: Section | null;
}

type PowerPointStep = "upload" | "review" | "design" | "quiz" | "done";

export function PowerPointWorkspaceCard({
  selectedTextbook,
  selectedChapter,
  selectedSection,
}: PowerPointWorkspaceCardProps): React.JSX.Element {
  const [step, setStep] = useState<PowerPointStep>("upload");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<ExtractedPresentation | null>(null);
  const [designSuggestions, setDesignSuggestions] = useState<DesignSuggestions | null>(null);
  const [kahootStyle, setKahootStyle] = useState(false);
  const [enableTimer, setEnableTimer] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(25);

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

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!isSupportedPresentationType(file)) {
      setErrorMessage("Please upload a .ppt or .pptx file.");
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setImportStatusMessage(file.name.toLowerCase().endsWith(".ppt")
      ? "Converting legacy .ppt file to .pptx before extraction..."
      : "Extracting slide content...");

    try {
      const extracted = await extractPresentationFromFile(file, {
        textbook: selectedTextbook,
        chapter: selectedChapter,
        section: selectedSection,
      });

      setPresentation(extracted);
      setDesignSuggestions(extracted.designSuggestions ?? null);
      setStep("review");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not import this presentation.");
    } finally {
      setImportStatusMessage(null);
      setIsBusy(false);
    }
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

  if (!selectedTextbook || !selectedChapter || !selectedSection) {
    return (
      <section className="panel">
        <h3>PowerPoints</h3>
        <p>Select a textbook, chapter, and section before importing a PowerPoint.</p>
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
        <span>Chapter: {selectedChapter.name}</span>
        <span>Section: {selectedSection.title}</span>
      </div>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      {successMessage ? <p className="sync-indicator sync-indicator--synced">{successMessage}</p> : null}
      {importStatusMessage ? <p>{importStatusMessage}</p> : null}

      {step === "upload" ? (
        <div className="powerpoint-upload">
          <label className="cover-file-label">
            Import PowerPoint
            <input
              type="file"
              accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="cover-file-input"
              onChange={(event) => {
                void handleImport(event);
              }}
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
