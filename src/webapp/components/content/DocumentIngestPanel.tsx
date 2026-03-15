import React, { useEffect, useRef, useState } from "react";

import type { DifficultyLevel } from "../../../core/models";
import {
  normalizeEquationInput,
  type EquationContext,
} from "../../../core/services/equationFormatService";
import type {
  DocumentExtractionContext,
  ExtractedDocumentData,
  TieredQuestionItem,
  TieredQuestionVariationRequestItem,
} from "../../../core/services/documentIngestService";
import {
  extractFromDocuments,
  generateTieredQuestionBankFromSeedItems,
  isSupportedDocumentType,
} from "../../../core/services/documentIngestService";
import { useRepositories } from "../../hooks/useRepositories";

interface DocumentIngestPanelProps {
  selectedSectionId: string | null;
  extractionContext?: DocumentExtractionContext;
  onDone: () => void;
}

type IngestStep = "upload" | "extracting" | "review" | "saving" | "done";

interface EditableVocabItem {
  word: string;
  definition?: string;
}

interface EditableConceptItem {
  name: string;
  explanation?: string;
}

interface PendingTieredVocabCreate {
  tieredId: string;
  question: string;
  correctAnswer: string;
  difficultyLevel: DifficultyLevel;
  isOriginal: boolean;
  variationOf: string | null;
  distractors: string[];
  sourceMetadata: TieredQuestionItem["sourceMetadata"];
}

interface PendingTieredConceptCreate {
  tieredId: string;
  question: string;
  correctAnswer: string;
  difficultyLevel: DifficultyLevel;
  isOriginal: boolean;
  variationOf: string | null;
  distractors: string[];
  sourceMetadata: TieredQuestionItem["sourceMetadata"];
}

const AI_MATERIALS_SKIP_KEY = "courseforge:ingest:alwaysSkipAiMaterials";

function isLevelOneWithoutVariations(item: { difficultyLevel?: DifficultyLevel; variationOf?: string | null }): boolean {
  const difficultyLevel = item.difficultyLevel ?? 1;
  return difficultyLevel === 1 && !item.variationOf;
}

function hasVariationAtLevel(items: Array<{ difficultyLevel?: DifficultyLevel; variationOf?: string | null }>, baseId: string, level: DifficultyLevel): boolean {
  return items.some((item) => item.variationOf === baseId && item.difficultyLevel === level);
}

function EditableList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
}): React.JSX.Element {
  return (
    <div className="ingest-review-section">
      <h4>{label} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="ingest-empty">None found.</p>
      ) : (
        <ul className="ingest-item-list">
          {items.map((item, index) => (
            <li key={index} className="ingest-item-row">
              <input
                value={item}
                aria-label={`${label} item ${index + 1}`}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = e.target.value;
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <button
                type="button"
                className="btn-icon btn-danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                title="Remove"
                aria-label="Remove item"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditablePairList({
  label,
  nameLabel,
  detailLabel,
  items,
  onChange,
}: {
  label: string;
  nameLabel: string;
  detailLabel: string;
  items: Array<{ name: string; detail?: string }>;
  onChange: (next: Array<{ name: string; detail?: string }>) => void;
}): React.JSX.Element {
  return (
    <div className="ingest-review-section">
      <h4>{label} ({items.length})</h4>
      {items.length === 0 ? (
        <p className="ingest-empty">None found.</p>
      ) : (
        <ul className="ingest-item-list">
          {items.map((item, index) => (
            <li key={index} className="ingest-item-row">
              <input
                value={item.name}
                aria-label={`${nameLabel} ${index + 1}`}
                placeholder={nameLabel}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], name: e.target.value };
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <input
                value={item.detail ?? ""}
                aria-label={`${detailLabel} ${index + 1}`}
                placeholder={detailLabel}
                onChange={(e) => {
                  const next = [...items];
                  next[index] = { ...next[index], detail: e.target.value || undefined };
                  onChange(next);
                }}
                className="ingest-item-input"
              />
              <button
                type="button"
                className="btn-icon btn-danger"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                title="Remove"
                aria-label="Remove item"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function normalizeForDedupe(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function DocumentIngestPanel({
  selectedSectionId,
  extractionContext,
  onDone,
}: DocumentIngestPanelProps): React.JSX.Element {
  const {
    createVocabTerm,
    createConcept,
    createEquation,
    createKeyIdea,
    fetchVocabTermsBySectionId,
    fetchConceptsBySectionId,
    fetchEquationsBySectionId,
    fetchKeyIdeasBySectionId,
  } = useRepositories();

  const [step, setStep] = useState<IngestStep>("upload");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedDocumentData | null>(null);
  const [saveSummaryMessage, setSaveSummaryMessage] = useState<string | null>(null);

  // Editable review state (mirrors `extracted` but user can edit before saving)
  const [reviewVocabItems, setReviewVocabItems] = useState<EditableVocabItem[]>([]);
  const [reviewConceptItems, setReviewConceptItems] = useState<EditableConceptItem[]>([]);
  const [reviewEquations, setReviewEquations] = useState<string[]>([]);
  const [reviewKeyIdeas, setReviewKeyIdeas] = useState<string[]>([]);
  const [reviewNamesAndDates, setReviewNamesAndDates] = useState<Array<{ name: string; date?: string }>>([]);
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [requestedDifficultyLevel, setRequestedDifficultyLevel] = useState<DifficultyLevel>(1);
  const [alwaysSkipAiMaterials, setAlwaysSkipAiMaterials] = useState<boolean>(() => {
    return window.localStorage.getItem(AI_MATERIALS_SKIP_KEY) === "1";
  });
  const [enrichMissingWithAi, setEnrichMissingWithAi] = useState<boolean>(() => {
    return window.localStorage.getItem(AI_MATERIALS_SKIP_KEY) !== "1";
  });
  const [missingAiCoverageCount, setMissingAiCoverageCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const blockingIssues = extracted?.quality.issues.filter((issue) => issue.severity === "error") ?? [];
  const warningIssues = extracted?.quality.issues.filter((issue) => issue.severity === "warning") ?? [];
  const canSaveExtractedContent = Boolean(extracted?.quality.accepted);
  const tieredCounts = {
    level1: extracted?.tieredQuestionBank?.level1.length ?? 0,
    level2: extracted?.tieredQuestionBank?.level2.length ?? 0,
    level3: extracted?.tieredQuestionBank?.level3.length ?? 0,
  };

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (!folderInput) {
      return;
    }

    folderInput.setAttribute("webkitdirectory", "");
    folderInput.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (step !== "review" || !selectedSectionId) {
      setMissingAiCoverageCount(0);
      return;
    }

    const sectionId = selectedSectionId;

    let isMounted = true;

    async function loadCoverage(): Promise<void> {
      const [existingVocab, existingConcepts] = await Promise.all([
        fetchVocabTermsBySectionId(sectionId),
        fetchConceptsBySectionId(sectionId),
      ]);

      if (!isMounted) {
        return;
      }

      const levelOneVocab = existingVocab.filter((item) => isLevelOneWithoutVariations(item) && (item.definition?.trim().length ?? 0) > 0);
      const levelOneConcepts = existingConcepts.filter((item) => isLevelOneWithoutVariations(item) && (item.explanation?.trim().length ?? 0) > 0);

      const missingVocab = levelOneVocab.filter((item) => {
        return !hasVariationAtLevel(existingVocab, item.id, 2) || !hasVariationAtLevel(existingVocab, item.id, 3);
      });
      const missingConcepts = levelOneConcepts.filter((item) => {
        return !hasVariationAtLevel(existingConcepts, item.id, 2) || !hasVariationAtLevel(existingConcepts, item.id, 3);
      });

      setMissingAiCoverageCount(missingVocab.length + missingConcepts.length);
    }

    void loadCoverage();

    return () => {
      isMounted = false;
    };
  }, [
    fetchConceptsBySectionId,
    fetchVocabTermsBySectionId,
    selectedSectionId,
    step,
  ]);

  async function handleFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const hasSupportedFile = files.some(isSupportedDocumentType);
    if (!hasSupportedFile) {
      setErrorMessage("No supported files were found. Use PDF, DOCX, TXT, HTML, Markdown, or RTF.");
      return;
    }

    setErrorMessage(null);
    setSaveSummaryMessage(null);
    setSelectedFileNames(files.map((file) => file.name));
    setStep("extracting");

    try {
      const data = await extractFromDocuments(files, {
        ...extractionContext,
        sectionId: selectedSectionId ?? undefined,
      });
      setExtracted(data);
      const extractedVocab: EditableVocabItem[] = data.vocabWithDefinitions?.length
        ? data.vocabWithDefinitions.map((entry) => ({ word: entry.word, definition: entry.definition }))
        : data.vocab.map((word) => ({ word }));

      const extractedConcepts: EditableConceptItem[] = data.conceptsWithExplanations?.length
        ? data.conceptsWithExplanations.map((entry) => ({ name: entry.name, explanation: entry.explanation }))
        : data.concepts.map((name) => ({ name }));

      setReviewVocabItems(
        extractedVocab.map((entry) => ({
          word: entry.word,
          definition: entry.definition,
        }))
      );
      setReviewConceptItems(
        extractedConcepts.map((entry) => ({
          name: entry.name,
          explanation: entry.explanation,
        }))
      );
      setReviewEquations([...data.equations]);
      setReviewKeyIdeas([...data.keyIdeas]);
      setReviewNamesAndDates(data.namesAndDates.map((nd) => ({ ...nd })));
      setStep("review");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Extraction failed. Please try again.");
      setStep("upload");
    }
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(event.target.files ?? []);
    await handleFiles(files);
    event.target.value = "";
  }

  async function handleDrop(event: React.DragEvent<HTMLDivElement>): Promise<void> {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    await handleFiles(files);
  }

  async function handleSave(): Promise<void> {
    if (!selectedSectionId) {
      setErrorMessage("No section selected. Please select a section first.");
      return;
    }

    setStep("saving");
    setErrorMessage(null);

    try {
      const [existingVocab, existingConcepts, existingEquations, existingKeyIdeas] = await Promise.all([
        fetchVocabTermsBySectionId(selectedSectionId),
        fetchConceptsBySectionId(selectedSectionId),
        fetchEquationsBySectionId(selectedSectionId),
        fetchKeyIdeasBySectionId(selectedSectionId),
      ]);

      const equationContext: EquationContext = {
        textbookSubject: extractionContext?.textbookSubject,
        textbookTitle: extractionContext?.textbookTitle,
        conceptName: extractionContext?.sectionTitle,
        gradeLevel: extractionContext?.gradeLevel,
      };

      const vocabSeen = new Set(existingVocab.map((item) => normalizeForDedupe(item.word)));
      const conceptSeen = new Set(existingConcepts.map((item) => normalizeForDedupe(item.name)));
      const equationSeen = new Set(existingEquations.map((item) => normalizeForDedupe(item.latex)));
      const keyIdeaSeen = new Set(existingKeyIdeas.map((item) => normalizeForDedupe(item.text)));

      const newVocab = reviewVocabItems
        .map((item) => ({
          word: item.word.trim(),
          definition: item.definition?.trim() || undefined,
        }))
        .filter((item) => item.word.length > 0)
        .filter((item) => {
          const normalized = normalizeForDedupe(item.word);
          if (vocabSeen.has(normalized)) {
            return false;
          }

          vocabSeen.add(normalized);
          return true;
        });

      const levelOneBySignature = new Map<string, TieredQuestionItem>();
      (extracted?.tieredQuestionBank?.level1 ?? []).forEach((item) => {
        const signature = `${item.contentType}:${normalizeForDedupe(item.question)}::${normalizeForDedupe(item.correctAnswer)}`;
        levelOneBySignature.set(signature, item);
      });

      const pendingLevelOneVocab: PendingTieredVocabCreate[] = newVocab.map((item) => {
        const signature = `vocab:${normalizeForDedupe(item.word)}::${normalizeForDedupe(item.definition ?? "")}`;
        const tiered = levelOneBySignature.get(signature);
        return {
          tieredId: tiered?.id ?? `vocab:${normalizeForDedupe(item.word)}:l1`,
          question: item.word,
          correctAnswer: item.definition ?? "",
          difficultyLevel: 1,
          isOriginal: true,
          variationOf: null,
          distractors: tiered?.distractors ?? [],
          sourceMetadata: tiered?.sourceMetadata ?? {
            sourceType: "document-ingest",
            originalFilename: selectedFileNames[0] ?? "document",
            variationAllowed: true,
          },
        };
      });

      const newConcepts = reviewConceptItems
        .map((item) => ({
          name: item.name.trim(),
          explanation: item.explanation?.trim() || undefined,
        }))
        .filter((item) => item.name.length > 0)
        .filter((item) => {
          const normalized = normalizeForDedupe(item.name);
          if (conceptSeen.has(normalized)) {
            return false;
          }

          conceptSeen.add(normalized);
          return true;
        });

      const pendingLevelOneConcepts: PendingTieredConceptCreate[] = newConcepts.map((item) => {
        const signature = `concept:${normalizeForDedupe(item.name)}::${normalizeForDedupe(item.explanation ?? "")}`;
        const tiered = levelOneBySignature.get(signature);
        return {
          tieredId: tiered?.id ?? `concept:${normalizeForDedupe(item.name)}:l1`,
          question: item.name,
          correctAnswer: item.explanation ?? "",
          difficultyLevel: 1,
          isOriginal: true,
          variationOf: null,
          distractors: tiered?.distractors ?? [],
          sourceMetadata: tiered?.sourceMetadata ?? {
            sourceType: "document-ingest",
            originalFilename: selectedFileNames[0] ?? "document",
            variationAllowed: true,
          },
        };
      });

      const newEquations = reviewEquations
        .map((item) => normalizeEquationInput({ raw: item, context: equationContext }))
        .map((result) => (result.repairSuggestion?.latex ?? result.latex).trim())
        .filter(Boolean)
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (equationSeen.has(normalized)) {
            return false;
          }

          equationSeen.add(normalized);
          return true;
        });

      const existingLevelOneVocabNeedingAi = existingVocab
        .filter((item) => isLevelOneWithoutVariations(item))
        .filter((item) => (item.definition?.trim().length ?? 0) > 0)
        .filter((item) => !hasVariationAtLevel(existingVocab, item.id, 2) || !hasVariationAtLevel(existingVocab, item.id, 3));

      const existingLevelOneConceptsNeedingAi = existingConcepts
        .filter((item) => isLevelOneWithoutVariations(item))
        .filter((item) => (item.explanation?.trim().length ?? 0) > 0)
        .filter((item) => !hasVariationAtLevel(existingConcepts, item.id, 2) || !hasVariationAtLevel(existingConcepts, item.id, 3));

      const newKeyIdeasFromReview = reviewKeyIdeas
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (keyIdeaSeen.has(normalized)) {
            return false;
          }

          keyIdeaSeen.add(normalized);
          return true;
        });

      const newKeyIdeasFromNames = reviewNamesAndDates
        .filter((item) => item.name.trim())
        .map((item) => {
          const name = item.name.trim();
          const date = item.date?.trim();
          return date ? `${name} (${date})` : name;
        })
        .filter((item) => {
          const normalized = normalizeForDedupe(item);
          if (keyIdeaSeen.has(normalized)) {
            return false;
          }

          keyIdeaSeen.add(normalized);
          return true;
        });

      const levelOneLinkByTieredId = new Map<string, string>();

      for (const entry of pendingLevelOneVocab) {
        const createdId = await createVocabTerm({
          sectionId: selectedSectionId,
          word: entry.question,
          definition: entry.correctAnswer || undefined,
          difficultyLevel: entry.difficultyLevel,
          isOriginal: entry.isOriginal,
          variationOf: entry.variationOf,
          questionStem: entry.question,
          correctAnswer: entry.correctAnswer || undefined,
          distractors: entry.distractors,
          sourceMetadata: entry.sourceMetadata,
        });
        levelOneLinkByTieredId.set(entry.tieredId, createdId);
      }

      for (const entry of pendingLevelOneConcepts) {
        const createdId = await createConcept({
          sectionId: selectedSectionId,
          name: entry.question,
          explanation: entry.correctAnswer || undefined,
          difficultyLevel: entry.difficultyLevel,
          isOriginal: entry.isOriginal,
          variationOf: entry.variationOf,
          questionStem: entry.question,
          correctAnswer: entry.correctAnswer || undefined,
          distractors: entry.distractors,
          sourceMetadata: entry.sourceMetadata,
        });
        levelOneLinkByTieredId.set(entry.tieredId, createdId);
      }

      const selectedTieredVariations = (extracted?.tieredQuestionBank?.all ?? [])
        .filter((item) => item.difficultyLevel === requestedDifficultyLevel && item.difficultyLevel !== 1);
      let savedVariationCount = 0;
      const savedVariationLevelKeys = new Set<string>([
        ...existingVocab
          .filter((item) => item.variationOf && item.difficultyLevel)
          .map((item) => `vocab:${item.variationOf}:${item.difficultyLevel}`),
        ...existingConcepts
          .filter((item) => item.variationOf && item.difficultyLevel)
          .map((item) => `concept:${item.variationOf}:${item.difficultyLevel}`),
      ]);

      for (const variation of selectedTieredVariations) {
        const variationKey = normalizeForDedupe(variation.question);
        if (variation.contentType === "vocab") {
          if (vocabSeen.has(variationKey)) {
            continue;
          }
          vocabSeen.add(variationKey);
        } else {
          if (conceptSeen.has(variationKey)) {
            continue;
          }
          conceptSeen.add(variationKey);
        }

        const linkedVariationOf = variation.variationOf ? (levelOneLinkByTieredId.get(variation.variationOf) ?? null) : null;

        if (variation.contentType === "vocab") {
          await createVocabTerm({
            sectionId: selectedSectionId,
            word: variation.question,
            definition: variation.correctAnswer,
            difficultyLevel: variation.difficultyLevel,
            isOriginal: false,
            variationOf: linkedVariationOf,
            questionStem: variation.question,
            correctAnswer: variation.correctAnswer,
            distractors: variation.distractors,
            sourceMetadata: variation.sourceMetadata,
          });
          savedVariationCount += 1;
          if (linkedVariationOf) {
            savedVariationLevelKeys.add(`vocab:${linkedVariationOf}:${variation.difficultyLevel}`);
          }
        } else {
          await createConcept({
            sectionId: selectedSectionId,
            name: variation.question,
            explanation: variation.correctAnswer,
            difficultyLevel: variation.difficultyLevel,
            isOriginal: false,
            variationOf: linkedVariationOf,
            questionStem: variation.question,
            correctAnswer: variation.correctAnswer,
            distractors: variation.distractors,
            sourceMetadata: variation.sourceMetadata,
          });
          savedVariationCount += 1;
          if (linkedVariationOf) {
            savedVariationLevelKeys.add(`concept:${linkedVariationOf}:${variation.difficultyLevel}`);
          }
        }
      }

      if (enrichMissingWithAi && !alwaysSkipAiMaterials) {
        const sourceMetadataFallback: TieredQuestionItem["sourceMetadata"] = {
          sourceType: "document-ingest",
          originalFilename: selectedFileNames[0] ?? "document",
          variationAllowed: true,
          educationalContext: {
            textbookTitle: extractionContext?.textbookTitle,
            textbookSubject: extractionContext?.textbookSubject,
            gradeLevel: extractionContext?.gradeLevel ? Number.parseInt(extractionContext.gradeLevel, 10) : undefined,
          },
        };

        const augmentationSeedItems: TieredQuestionVariationRequestItem[] = [
          ...existingLevelOneVocabNeedingAi.map((item) => ({
            id: item.id,
            contentType: "vocab" as const,
            question: item.word,
            correctAnswer: item.definition ?? "",
            sourceMetadata: item.sourceMetadata ?? sourceMetadataFallback,
          })),
          ...existingLevelOneConceptsNeedingAi.map((item) => ({
            id: item.id,
            contentType: "concept" as const,
            question: item.name,
            correctAnswer: item.explanation ?? "",
            sourceMetadata: item.sourceMetadata ?? sourceMetadataFallback,
          })),
          ...pendingLevelOneVocab.map((item) => {
            const linkedBaseId = levelOneLinkByTieredId.get(item.tieredId) ?? item.tieredId;
            return {
              id: linkedBaseId,
              contentType: "vocab" as const,
              question: item.question,
              correctAnswer: item.correctAnswer,
              sourceMetadata: item.sourceMetadata,
            };
          }),
          ...pendingLevelOneConcepts.map((item) => {
            const linkedBaseId = levelOneLinkByTieredId.get(item.tieredId) ?? item.tieredId;
            return {
              id: linkedBaseId,
              contentType: "concept" as const,
              question: item.question,
              correctAnswer: item.correctAnswer,
              sourceMetadata: item.sourceMetadata,
            };
          }),
        ].filter((item) => item.question.trim().length > 0 && item.correctAnswer.trim().length > 0);

        const seedBySignature = new Map<string, TieredQuestionVariationRequestItem>();
        augmentationSeedItems.forEach((item) => {
          const signature = `${item.contentType}:${normalizeForDedupe(item.question)}::${normalizeForDedupe(item.correctAnswer)}`;
          if (!seedBySignature.has(signature)) {
            seedBySignature.set(signature, item);
          }
        });

        const chapterTerms = Array.from(new Set([
          ...reviewVocabItems.map((item) => item.word.trim()).filter(Boolean),
          ...reviewConceptItems.map((item) => item.name.trim()).filter(Boolean),
          ...existingVocab.map((item) => item.word.trim()).filter(Boolean),
          ...existingConcepts.map((item) => item.name.trim()).filter(Boolean),
        ]));

        const generatedTiered = await generateTieredQuestionBankFromSeedItems({
          seedItems: [...seedBySignature.values()],
          chapterTerms,
          context: extractionContext,
        });

        const variationBaseLinkByKey = new Map<string, string>();
        [...seedBySignature.values()].forEach((item) => {
          variationBaseLinkByKey.set(`${item.id}:l1`, item.id);
        });

        for (const variation of generatedTiered.all) {
          if (variation.difficultyLevel !== 2 && variation.difficultyLevel !== 3) {
            continue;
          }

          const linkedVariationOf = variation.variationOf
            ? (variationBaseLinkByKey.get(variation.variationOf) ?? null)
            : null;

          if (!linkedVariationOf) {
            continue;
          }

          const levelKey = `${variation.contentType}:${linkedVariationOf}:${variation.difficultyLevel}`;
          if (savedVariationLevelKeys.has(levelKey)) {
            continue;
          }

          const variationKey = normalizeForDedupe(variation.question);
          if (variation.contentType === "vocab") {
            if (vocabSeen.has(variationKey)) {
              continue;
            }
            vocabSeen.add(variationKey);
            await createVocabTerm({
              sectionId: selectedSectionId,
              word: variation.question,
              definition: variation.correctAnswer,
              difficultyLevel: variation.difficultyLevel,
              isOriginal: false,
              variationOf: linkedVariationOf,
              questionStem: variation.question,
              correctAnswer: variation.correctAnswer,
              distractors: variation.distractors,
              sourceMetadata: variation.sourceMetadata,
            });
          } else {
            if (conceptSeen.has(variationKey)) {
              continue;
            }
            conceptSeen.add(variationKey);
            await createConcept({
              sectionId: selectedSectionId,
              name: variation.question,
              explanation: variation.correctAnswer,
              difficultyLevel: variation.difficultyLevel,
              isOriginal: false,
              variationOf: linkedVariationOf,
              questionStem: variation.question,
              correctAnswer: variation.correctAnswer,
              distractors: variation.distractors,
              sourceMetadata: variation.sourceMetadata,
            });
          }

          savedVariationLevelKeys.add(levelKey);
          savedVariationCount += 1;
        }
      }

      await Promise.all([
        ...newEquations.map((latex) => createEquation({ sectionId: selectedSectionId, name: latex, latex })),
        ...newKeyIdeasFromReview.map((text) => createKeyIdea({ sectionId: selectedSectionId, text })),
        ...newKeyIdeasFromNames.map((text) => createKeyIdea({ sectionId: selectedSectionId, text })),
      ]);

      const createdCount =
        newVocab.length +
        newConcepts.length +
        savedVariationCount +
        newEquations.length +
        newKeyIdeasFromReview.length +
        newKeyIdeasFromNames.length;
      setSaveSummaryMessage(
        createdCount === 0
          ? "No new items were added because everything in this import already exists in the section."
          : `Saved ${createdCount} new item(s) to this section.`
      );
      setStep("done");
    } catch {
      setErrorMessage("Some items could not be saved. Please try again.");
      setStep("review");
    }
  }

  if (!selectedSectionId) {
    return (
      <section className="panel ingest-panel">
        <h3>Upload Document</h3>
        <p className="error-text">Select a section before uploading a document.</p>
      </section>
    );
  }

  return (
    <section className="panel ingest-panel">
      <h3>Upload Document for Extraction</h3>

      {step === "upload" && (
        <>
          <p>Upload one or more PDF, DOCX, TXT, HTML, Markdown, or RTF files. You can drag files in, browse to them, or scan an entire folder.</p>
          <div
            className="ingest-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            aria-label="Drag and drop documents here or browse for files"
          >
            <strong>Drop documents here</strong>
            <p className="ingest-layout-summary">Best results come from chapter-specific exports rather than mixed folders.</p>
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
              aria-label="Browse Files"
              multiple
              accept=".pdf,.txt,.docx,.html,.htm,.md,.markdown,.rtf,text/plain,text/html,application/xhtml+xml,text/markdown,text/x-markdown,text/rtf,application/rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => void handleFileSelected(e)}
              className="cover-file-input"
            />
          </label>
          <label className="cover-file-label cover-file-label-hidden">
            Scan Folder
            <input
              ref={folderInputRef}
              type="file"
              aria-label="Scan Folder"
              multiple
              onChange={(e) => void handleFileSelected(e)}
              className="cover-file-input"
            />
          </label>
          {errorMessage ? (
            <div className="ingest-alert ingest-alert-error" role="alert">
              <strong>Could not start import.</strong>
              <p>{errorMessage}</p>
              <p>Try a chapter-specific PDF, DOCX, TXT, HTML, Markdown, or RTF export instead.</p>
            </div>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        </>
      )}

      {step === "extracting" && (
        <p>Extracting content with AI… Please wait.</p>
      )}

      {step === "review" && extracted !== null && (
        <>
          <p>Review and edit the extracted items below, then click Save to add them to this section.</p>

          <div className="ingest-difficulty-controls" role="group" aria-label="Difficulty generation controls">
            <p className="ingest-layout-summary">Choose which question tier to save for this import.</p>
            <div className="ingest-difficulty-actions">
              <button
                type="button"
                className={requestedDifficultyLevel === 1 ? "btn-secondary" : "cover-file-label ingest-picker-button"}
                onClick={() => setRequestedDifficultyLevel(1)}
              >
                Use Original Set (Level 1)
              </button>
              <button
                type="button"
                className={requestedDifficultyLevel === 2 ? "btn-secondary" : "cover-file-label ingest-picker-button"}
                onClick={() => setRequestedDifficultyLevel(2)}
              >
                Generate Practice Set (Level 2)
              </button>
              <button
                type="button"
                className={requestedDifficultyLevel === 3 ? "btn-secondary" : "cover-file-label ingest-picker-button"}
                onClick={() => setRequestedDifficultyLevel(3)}
              >
                Generate Pre-Test Review (Level 3)
              </button>
            </div>
            <p className="ingest-layout-summary">
              Tier counts: L1 {tieredCounts.level1} · L2 {tieredCounts.level2} · L3 {tieredCounts.level3}
            </p>

            <div className="ingest-review-section">
              <h4>AI Harder-Material Options</h4>
              {missingAiCoverageCount > 0 ? (
                <p className="ingest-layout-summary">
                  Detected {missingAiCoverageCount} existing Level 1 item(s) in this section that are missing Level 2/3 AI variants.
                </p>
              ) : (
                <p className="ingest-layout-summary">
                  Existing section content already has Level 2/3 coverage, or no Level 1 definitions were available to augment.
                </p>
              )}

              <label>
                <input
                  type="checkbox"
                  checked={enrichMissingWithAi && !alwaysSkipAiMaterials}
                  onChange={(event) => setEnrichMissingWithAi(event.target.checked)}
                  disabled={alwaysSkipAiMaterials}
                />
                Add AI-generated Level 2 and Level 3 items for any missing Level 1 vocab/concepts.
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={alwaysSkipAiMaterials}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setAlwaysSkipAiMaterials(checked);
                    if (checked) {
                      setEnrichMissingWithAi(false);
                    }
                    window.localStorage.setItem(AI_MATERIALS_SKIP_KEY, checked ? "1" : "0");
                  }}
                />
                Always skip AI-generated materials for future imports on this device.
              </label>
            </div>
          </div>

          {selectedFileNames.length > 0 ? (
            <p className="ingest-layout-summary">Processed {selectedFileNames.length} file(s): {selectedFileNames.join(", ")}.</p>
          ) : null}

          {blockingIssues.length > 0 ? (
            <div className="ingest-alert ingest-alert-error" role="alert">
              <strong>Import blocked.</strong>
              <ul className="ingest-issue-list">
                {blockingIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
              <p>Use a chapter-specific instructional document. Avoid source code, unrelated handouts, and mixed next-chapter material.</p>
            </div>
          ) : null}

          {warningIssues.length > 0 ? (
            <div className="ingest-alert ingest-alert-warning" role="status">
              <strong>Review notes.</strong>
              <ul className="ingest-issue-list">
                {warningIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {extracted.inferredChapterTitle || extracted.inferredSectionTitle ? (
            <p className="ingest-layout-summary">
              Inferred destination: {extracted.inferredChapterTitle ? `Chapter ${extracted.inferredChapterTitle}` : "Chapter unknown"}
              {" · "}
              {extracted.inferredSectionTitle ? `Section ${extracted.inferredSectionTitle}` : "Section unknown"}
            </p>
          ) : null}

          {extracted.quality.questionAnswerLayouts.length > 0 ? (
            <p className="ingest-layout-summary">
              Detected worksheet layout: {extracted.quality.questionAnswerLayouts.join(", ")}.
            </p>
          ) : null}

          <EditablePairList
            label="Vocab Terms"
            nameLabel="Word"
            detailLabel="Definition (optional)"
            items={reviewVocabItems.map((item) => ({ name: item.word, detail: item.definition }))}
            onChange={(next) => setReviewVocabItems(next.map((item) => ({ word: item.name, definition: item.detail })))}
          />
          <EditablePairList
            label="Concepts"
            nameLabel="Concept"
            detailLabel="Explanation (optional)"
            items={reviewConceptItems.map((item) => ({ name: item.name, detail: item.explanation }))}
            onChange={(next) => setReviewConceptItems(next.map((item) => ({ name: item.name, explanation: item.detail })))}
          />
          <EditableList label="Equations" items={reviewEquations} onChange={setReviewEquations} />
          <EditableList label="Key Ideas" items={reviewKeyIdeas} onChange={setReviewKeyIdeas} />

          <div className="ingest-review-section">
            <h4>Names & Dates ({reviewNamesAndDates.length})</h4>
            {reviewNamesAndDates.length === 0 ? (
              <p className="ingest-empty">None found.</p>
            ) : (
              <ul className="ingest-item-list">
                {reviewNamesAndDates.map((nd, index) => (
                  <li key={index} className="ingest-item-row">
                    <input
                      value={nd.name}
                      placeholder="Name"
                      onChange={(e) => {
                        const next = [...reviewNamesAndDates];
                        next[index] = { ...nd, name: e.target.value };
                        setReviewNamesAndDates(next);
                      }}
                      className="ingest-item-input"
                    />
                    <input
                      value={nd.date ?? ""}
                      placeholder="Date (optional)"
                      onChange={(e) => {
                        const next = [...reviewNamesAndDates];
                        next[index] = { ...nd, date: e.target.value || undefined };
                        setReviewNamesAndDates(next);
                      }}
                      className="ingest-item-input ingest-item-date"
                    />
                    <button
                      type="button"
                      className="btn-icon btn-danger"
                      onClick={() => setReviewNamesAndDates((prev) => prev.filter((_, i) => i !== index))}
                      title="Remove"
                      aria-label="Remove name/date"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

          <div className="form-actions">
            <button type="button" onClick={() => void handleSave()} disabled={!canSaveExtractedContent}>
              Save to Section
            </button>
            <button type="button" className="btn-secondary" onClick={onDone}>
              Discard
            </button>
          </div>
        </>
      )}

      {step === "saving" && (
        <p>Saving items to section…</p>
      )}

      {step === "done" && (
        <>
          <p className="success-text">{saveSummaryMessage ?? "Items saved successfully to this section."}</p>
          <button type="button" onClick={onDone}>
            Close
          </button>
        </>
      )}
    </section>
  );
}
