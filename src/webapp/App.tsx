import React from "react";

import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { ChapterForm } from "./components/chapters/ChapterForm";
import { ChapterList } from "./components/chapters/ChapterList";
import { ConceptForm } from "./components/content/ConceptForm";
import { ConceptList } from "./components/content/ConceptList";
import { EquationForm } from "./components/content/EquationForm";
import { EquationList } from "./components/content/EquationList";
import { KeyIdeaForm } from "./components/content/KeyIdeaForm";
import { KeyIdeaList } from "./components/content/KeyIdeaList";
import { VocabForm } from "./components/content/VocabForm";
import { VocabList } from "./components/content/VocabList";
import { ExportPanel } from "./components/export/ExportPanel";
import { SectionForm } from "./components/sections/SectionForm";
import { SectionList } from "./components/sections/SectionList";
import { TextbookForm } from "./components/textbooks/TextbookForm";
import { TextbookList } from "./components/textbooks/TextbookList";

/**
 * Root shell for the CourseForge webapp.
 * Phase C1 keeps this intentionally minimal before feature-specific UI is added.
 */
export function App(): React.JSX.Element {
  const [textbookRefreshKey, setTextbookRefreshKey] = React.useState(0);
  const [chapterRefreshKey, setChapterRefreshKey] = React.useState(0);
  const [sectionRefreshKey, setSectionRefreshKey] = React.useState(0);
  const [vocabRefreshKey, setVocabRefreshKey] = React.useState(0);
  const [equationRefreshKey, setEquationRefreshKey] = React.useState(0);
  const [conceptRefreshKey, setConceptRefreshKey] = React.useState(0);
  const [keyIdeaRefreshKey, setKeyIdeaRefreshKey] = React.useState(0);
  const [selectedTextbookId, setSelectedTextbookId] = React.useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = React.useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = React.useState<string | null>(null);

  function handleTextbookSaved(): void {
    setTextbookRefreshKey((current) => current + 1);
  }

  function handleChapterSaved(): void {
    setChapterRefreshKey((current) => current + 1);
  }

  function handleSectionSaved(): void {
    setSectionRefreshKey((current) => current + 1);
  }

  function handleVocabSaved(): void {
    setVocabRefreshKey((current) => current + 1);
  }

  function handleEquationSaved(): void {
    setEquationRefreshKey((current) => current + 1);
  }

  function handleConceptSaved(): void {
    setConceptRefreshKey((current) => current + 1);
  }

  function handleKeyIdeaSaved(): void {
    setKeyIdeaRefreshKey((current) => current + 1);
  }

  function handleTextbookSelected(id: string): void {
    setSelectedTextbookId(id);
    setSelectedChapterId(null);
    setSelectedSectionId(null);
  }

  function handleChapterSelected(id: string): void {
    setSelectedChapterId(id);
    setSelectedSectionId(null);
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="app-main">
        <Header />

        <section className="placeholder-panel">
          <h2>Webapp Shell</h2>
          <p>Phase C2 now includes textbook/chapter/section CRUD plus section content capture.</p>
        </section>

        <div className="panel-grid">
          <TextbookForm onSaved={handleTextbookSaved} />
          <TextbookList
            refreshKey={textbookRefreshKey}
            selectedTextbookId={selectedTextbookId}
            onSelectTextbook={handleTextbookSelected}
          />
        </div>

        <div className="panel-grid">
          <ChapterForm selectedTextbookId={selectedTextbookId} onSaved={handleChapterSaved} />
          <ChapterList
            selectedTextbookId={selectedTextbookId}
            selectedChapterId={selectedChapterId}
            onSelectChapter={handleChapterSelected}
            refreshKey={chapterRefreshKey}
          />
        </div>

        <div className="panel-grid">
          <SectionForm selectedChapterId={selectedChapterId} onSaved={handleSectionSaved} />
          <SectionList
            selectedChapterId={selectedChapterId}
            selectedSectionId={selectedSectionId}
            onSelectSection={setSelectedSectionId}
            refreshKey={sectionRefreshKey}
          />
        </div>

        <div className="panel-grid">
          <VocabForm selectedSectionId={selectedSectionId} onSaved={handleVocabSaved} />
          <VocabList selectedSectionId={selectedSectionId} refreshKey={vocabRefreshKey} />
        </div>

        <div className="panel-grid">
          <EquationForm selectedSectionId={selectedSectionId} onSaved={handleEquationSaved} />
          <EquationList selectedSectionId={selectedSectionId} refreshKey={equationRefreshKey} />
        </div>

        <div className="panel-grid">
          <ConceptForm selectedSectionId={selectedSectionId} onSaved={handleConceptSaved} />
          <ConceptList selectedSectionId={selectedSectionId} refreshKey={conceptRefreshKey} />
        </div>

        <div className="panel-grid">
          <KeyIdeaForm selectedSectionId={selectedSectionId} onSaved={handleKeyIdeaSaved} />
          <KeyIdeaList selectedSectionId={selectedSectionId} refreshKey={keyIdeaRefreshKey} />
        </div>

        <div className="panel-grid">
          <ExportPanel
            selectedTextbookId={selectedTextbookId ?? undefined}
            selectedChapterId={selectedChapterId ?? undefined}
            selectedSectionId={selectedSectionId ?? undefined}
          />
        </div>
      </main>
    </div>
  );
}
