import React from "react";

import { QuickConceptForm } from "./components/content/QuickConceptForm";
import { QuickEquationForm } from "./components/content/QuickEquationForm";
import { QuickKeyIdeaForm } from "./components/content/QuickKeyIdeaForm";
import { QuickVocabForm } from "./components/content/QuickVocabForm";
import { QuickAddTabs, type QuickAddMode } from "./components/QuickAddTabs";
import { SidebarExportPanel } from "./components/export/SidebarExportPanel";
import { ChapterSelector } from "./components/selectors/ChapterSelector";
import { SectionSelector } from "./components/selectors/SectionSelector";
import { TextbookSelector } from "./components/selectors/TextbookSelector";
import { useRepositories } from "./hooks/useRepositories";

/**
 * Root shell for the browser extension sidebar.
 * Manages selection persistence via localStorage and quick-add mode switching.
 */
export function SidebarApp(): React.JSX.Element {
  const {
    fetchChapterById,
    fetchSectionById,
    fetchTextbookById,
    fetchChaptersByTextbookId,
    fetchSectionsByChapterId,
  } = useRepositories();

  const [selectedTextbookId, setSelectedTextbookId] = React.useState<string | undefined>();
  const [selectedChapterId, setSelectedChapterId] = React.useState<string | undefined>();
  const [selectedSectionId, setSelectedSectionId] = React.useState<string | undefined>();
  const [quickAddMode, setQuickAddMode] = React.useState<QuickAddMode>("vocab");
  const [quickSaveCount, setQuickSaveCount] = React.useState(0);
  const [selectedTextbookTitle, setSelectedTextbookTitle] = React.useState("None");
  const [selectedChapterName, setSelectedChapterName] = React.useState("None");
  const [selectedSectionTitle, setSelectedSectionTitle] = React.useState("None");

  /**
   * Restore persisted selections and quick-add mode from localStorage on mount.
   * Validates that restored items still exist by fetching them.
   */
  React.useEffect(() => {
    async function restorePersistedState(): Promise<void> {
      // Restore quick-add mode
      const savedMode = localStorage.getItem("courseforge-quickAddMode") as QuickAddMode | null;
      if (savedMode && ["vocab", "equation", "concept", "keyidea"].includes(savedMode)) {
        setQuickAddMode(savedMode);
      }

      // Restore and validate textbook
      const savedTextbookId = localStorage.getItem("courseforge-selectedTextbookId");
      if (savedTextbookId) {
        const textbook = await fetchTextbookById(savedTextbookId);
        if (textbook) {
          setSelectedTextbookId(savedTextbookId);

          // Restore and validate chapter (only if textbook is valid)
          const savedChapterId = localStorage.getItem("courseforge-selectedChapterId");
          if (savedChapterId) {
            const chapters = await fetchChaptersByTextbookId(savedTextbookId);
            const chapterExists = chapters.some((c) => c.id === savedChapterId);
            if (chapterExists) {
              setSelectedChapterId(savedChapterId);

              // Restore and validate section (only if chapter is valid)
              const savedSectionId = localStorage.getItem("courseforge-selectedSectionId");
              if (savedSectionId) {
                const sections = await fetchSectionsByChapterId(savedChapterId);
                const sectionExists = sections.some((s) => s.id === savedSectionId);
                if (sectionExists) {
                  setSelectedSectionId(savedSectionId);
                }
              }
            }
          }
        }
      }
    }

    void restorePersistedState();
  }, [fetchTextbookById, fetchChaptersByTextbookId, fetchSectionsByChapterId]);

  /**
   * Persist selections and quick-add mode to localStorage whenever they change.
   */
  React.useEffect(() => {
    if (selectedTextbookId) {
      localStorage.setItem("courseforge-selectedTextbookId", selectedTextbookId);
    } else {
      localStorage.removeItem("courseforge-selectedTextbookId");
    }
  }, [selectedTextbookId]);

  React.useEffect(() => {
    if (selectedChapterId) {
      localStorage.setItem("courseforge-selectedChapterId", selectedChapterId);
    } else {
      localStorage.removeItem("courseforge-selectedChapterId");
    }
  }, [selectedChapterId]);

  React.useEffect(() => {
    if (selectedSectionId) {
      localStorage.setItem("courseforge-selectedSectionId", selectedSectionId);
    } else {
      localStorage.removeItem("courseforge-selectedSectionId");
    }
  }, [selectedSectionId]);

  React.useEffect(() => {
    localStorage.setItem("courseforge-quickAddMode", quickAddMode);
  }, [quickAddMode]);

  function handleQuickSaved(): void {
    setQuickSaveCount((current) => current + 1);
  }

  function handleTextbookChange(id: string | undefined): void {
    setSelectedTextbookId(id);
    setSelectedChapterId(undefined);
    setSelectedSectionId(undefined);
  }

  function handleChapterChange(id: string | undefined): void {
    setSelectedChapterId(id);
    setSelectedSectionId(undefined);
  }

  React.useEffect(() => {
    async function loadTextbookSummary(): Promise<void> {
      if (!selectedTextbookId) {
        setSelectedTextbookTitle("None");
        return;
      }

      const textbook = await fetchTextbookById(selectedTextbookId);
      setSelectedTextbookTitle(textbook?.title ?? "Unknown");
    }

    void loadTextbookSummary();
  }, [fetchTextbookById, selectedTextbookId]);

  React.useEffect(() => {
    async function loadChapterSummary(): Promise<void> {
      if (!selectedChapterId) {
        setSelectedChapterName("None");
        return;
      }

      const chapter = await fetchChapterById(selectedChapterId);
      setSelectedChapterName(chapter ? `${chapter.index}. ${chapter.name}` : "Unknown");
    }

    void loadChapterSummary();
  }, [fetchChapterById, selectedChapterId]);

  React.useEffect(() => {
    async function loadSectionSummary(): Promise<void> {
      if (!selectedSectionId) {
        setSelectedSectionTitle("None");
        return;
      }

      const section = await fetchSectionById(selectedSectionId);
      setSelectedSectionTitle(section ? `${section.index}. ${section.title}` : "Unknown");
    }

    void loadSectionSummary();
  }, [fetchSectionById, selectedSectionId]);

  return (
    <div className="sidebar-shell">
      <header>
        <h1 className="sidebar-title">CourseForge Sidebar</h1>
        <p className="sidebar-subtitle">
          Quick capture workspace
        </p>
      </header>

      <section>
        <h2 className="sidebar-section-title">Selectors</h2>
        <div className="selector-grid">
          <TextbookSelector
            selectedTextbookId={selectedTextbookId}
            onSelectTextbook={handleTextbookChange}
          />
          <ChapterSelector
            selectedTextbookId={selectedTextbookId}
            selectedChapterId={selectedChapterId}
            onSelectChapter={handleChapterChange}
          />
          <SectionSelector
            selectedChapterId={selectedChapterId}
            selectedSectionId={selectedSectionId}
            onSelectSection={setSelectedSectionId}
          />
        </div>
      </section>

      <section>
        <h2 className="sidebar-section-title">Quick Add</h2>
        <div className="selection-summary" role="status" aria-live="polite">
          <p>
            <strong>Textbook:</strong> {selectedTextbookTitle}
          </p>
          <p>
            <strong>Chapter:</strong> {selectedChapterName}
          </p>
          <p>
            <strong>Section:</strong> {selectedSectionTitle}
          </p>
          <p>
            <strong>Quick Saves:</strong> {quickSaveCount}
          </p>
        </div>
        <QuickAddTabs activeMode={quickAddMode} onModeChange={setQuickAddMode} />
        <div className="quick-form-container">
          {quickAddMode === "vocab" && (
            <QuickVocabForm selectedSectionId={selectedSectionId} onSaved={handleQuickSaved} />
          )}
          {quickAddMode === "equation" && (
            <QuickEquationForm selectedSectionId={selectedSectionId} onSaved={handleQuickSaved} />
          )}
          {quickAddMode === "concept" && (
            <QuickConceptForm selectedSectionId={selectedSectionId} onSaved={handleQuickSaved} />
          )}
          {quickAddMode === "keyidea" && (
            <QuickKeyIdeaForm selectedSectionId={selectedSectionId} onSaved={handleQuickSaved} />
          )}
        </div>
      </section>

      <SidebarExportPanel
        selectedTextbookId={selectedTextbookId}
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
      />
    </div>
  );
}
