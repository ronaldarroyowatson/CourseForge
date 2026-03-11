import React from "react";
import type { Textbook } from "../core/models";
import { initDB } from "../core/services/db";
import { getAll as getAllTextbooks } from "../core/services/repositories/textbookRepository";

import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { AccordionTile } from "./components/layout/AccordionTile";
import { WorkflowRibbon, type WorkflowTab } from "./components/layout/WorkflowRibbon";
import { ChapterForm } from "./components/chapters/ChapterForm";
import { ChapterList } from "./components/chapters/ChapterList";
import { SectionForm } from "./components/sections/SectionForm";
import { SectionList } from "./components/sections/SectionList";
import { TextbookForm } from "./components/textbooks/TextbookForm";
import { TextbookList } from "./components/textbooks/TextbookList";
import { getCurrentUser, onAuthStateChangedListener, signInWithGoogle } from "../firebase/auth";

/**
 * Root shell for the CourseForge webapp.
 * Phase C1 keeps this intentionally minimal before feature-specific UI is added.
 */
export function App(): React.JSX.Element {
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = React.useState<string | null>(null);
  const [textbooks, setTextbooks] = React.useState<Textbook[]>([]);
  const [isLoadingTextbooks, setIsLoadingTextbooks] = React.useState(true);
  const [textbookLoadError, setTextbookLoadError] = React.useState<string | null>(null);
  const [textbookRefreshKey, setTextbookRefreshKey] = React.useState(0);
  const [chapterRefreshKey, setChapterRefreshKey] = React.useState(0);
  const [sectionRefreshKey, setSectionRefreshKey] = React.useState(0);
  const [selectedTextbookId, setSelectedTextbookId] = React.useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = React.useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = React.useState<string | null>(null);
  const [activeWorkflowTab, setActiveWorkflowTab] = React.useState<WorkflowTab>("textbook");
  const [expandedTile, setExpandedTile] = React.useState<WorkflowTab | null>("textbook");

  React.useEffect(() => {
    setCurrentUserEmail(getCurrentUser()?.email ?? null);

    const unsubscribe = onAuthStateChangedListener((user) => {
      setCurrentUserEmail(user?.email ?? null);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    let isMounted = true;

    async function loadTextbooks(): Promise<void> {
      try {
        setIsLoadingTextbooks(true);
        setTextbookLoadError(null);
        await initDB();
        const results = await getAllTextbooks();

        if (!isMounted) {
          return;
        }

        setTextbooks(results);
      } catch {
        if (isMounted) {
          setTextbooks([]);
          setTextbookLoadError("Unable to load textbooks from the local database.");
        }
      } finally {
        if (isMounted) {
          setIsLoadingTextbooks(false);
        }
      }
    }

    void loadTextbooks();

    return () => {
      isMounted = false;
    };
  }, [textbookRefreshKey]);

  React.useEffect(() => {
    if (!selectedTextbookId) {
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
      return;
    }

    const hasSelectedTextbook = textbooks.some((textbook) => textbook.id === selectedTextbookId);
    if (!hasSelectedTextbook) {
      setSelectedTextbookId(null);
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
    }
  }, [selectedTextbookId, textbooks]);

  React.useEffect(() => {
    if (!selectedTextbookId && activeWorkflowTab !== "textbook") {
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
      return;
    }

    if (!selectedChapterId && activeWorkflowTab === "sections") {
      setActiveWorkflowTab(selectedTextbookId ? "chapters" : "textbook");
      setExpandedTile(selectedTextbookId ? "chapters" : "textbook");
    }
  }, [activeWorkflowTab, selectedChapterId, selectedTextbookId]);

  function handleTextbookSaved(): void {
    setTextbookRefreshKey((current) => current + 1);
    setActiveWorkflowTab("textbook");
    setExpandedTile("textbook");
  }

  function handleChapterSaved(): void {
    setChapterRefreshKey((current) => current + 1);
  }

  function handleSectionSaved(): void {
    setSectionRefreshKey((current) => current + 1);
  }

  function handleTextbookSelected(id: string): void {
    setSelectedTextbookId(id);
    setSelectedChapterId(null);
    setSelectedSectionId(null);
    setActiveWorkflowTab("chapters");
    setExpandedTile("chapters");
  }

  function handleChapterSelected(id: string): void {
    setSelectedChapterId(id);
    setSelectedSectionId(null);
    setActiveWorkflowTab("sections");
    setExpandedTile("sections");
  }

  function handleTextbookDeleted(id: string): void {
    setTextbooks((current) => current.filter((textbook) => textbook.id !== id));

    if (selectedTextbookId === id) {
      setSelectedTextbookId(null);
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
    }
  }

  async function handleGoogleSignIn(): Promise<void> {
    setIsSigningIn(true);
    setSignInError(null);

    try {
      const user = await signInWithGoogle();
      console.log("Signed in user uid:", user.uid);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sign in with Google.";
      setSignInError(message);
      console.error("Google sign-in failed:", error);
    } finally {
      setIsSigningIn(false);
    }
  }

  function renderWorkflowPanel(): React.JSX.Element | null {
    if (activeWorkflowTab === "textbook") {
      return (
        <AccordionTile
          title="Textbook"
          summary={selectedTextbookId ? "A textbook is selected for onboarding." : "Create or select a textbook to continue."}
          isExpanded={expandedTile === "textbook"}
          onToggle={() => setExpandedTile((current) => current === "textbook" ? null : "textbook")}
        >
          <div className="panel-grid">
            <TextbookForm onSaved={handleTextbookSaved} />
            <TextbookList
              textbooks={textbooks}
              isLoading={isLoadingTextbooks}
              loadError={textbookLoadError}
              selectedTextbookId={selectedTextbookId}
              onSelectTextbook={handleTextbookSelected}
              onDeleted={handleTextbookDeleted}
            />
          </div>
        </AccordionTile>
      );
    }

    if (activeWorkflowTab === "chapters" && selectedTextbookId) {
      return (
        <AccordionTile
          title="Chapters"
          summary={selectedTextbookId ? "Add the next chapter for the selected textbook." : "Select a textbook to unlock chapter setup."}
          isExpanded={expandedTile === "chapters"}
          onToggle={() => setExpandedTile((current) => current === "chapters" ? null : "chapters")}
        >
          <div className="panel-grid">
            <ChapterForm
              selectedTextbookId={selectedTextbookId}
              refreshKey={chapterRefreshKey}
              onSaved={handleChapterSaved}
            />
            <ChapterList
              selectedTextbookId={selectedTextbookId}
              selectedChapterId={selectedChapterId}
              onSelectChapter={handleChapterSelected}
              refreshKey={chapterRefreshKey}
            />
          </div>
        </AccordionTile>
      );
    }

    if (activeWorkflowTab === "sections" && selectedChapterId) {
      return (
        <AccordionTile
          title="Sections"
          summary="Add the next section for the selected chapter."
          isExpanded={expandedTile === "sections"}
          onToggle={() => setExpandedTile((current) => current === "sections" ? null : "sections")}
        >
          <div className="panel-grid">
            <SectionForm
              selectedChapterId={selectedChapterId}
              refreshKey={sectionRefreshKey}
              onSaved={handleSectionSaved}
            />
            <SectionList
              selectedChapterId={selectedChapterId}
              selectedSectionId={selectedSectionId}
              onSelectSection={setSelectedSectionId}
              refreshKey={sectionRefreshKey}
            />
          </div>
        </AccordionTile>
      );
    }

    return null;
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="app-main">
        <Header />

        <section className="placeholder-panel">
          <h2>Onboarding Workflow</h2>
          <p>Set up textbooks, chapters, and sections in sequence, then continue into section content capture.</p>
          <p><strong>Auth:</strong> {currentUserEmail ?? "Not signed in"}</p>
          <button type="button" onClick={() => { void handleGoogleSignIn(); }} disabled={isSigningIn}>
            {isSigningIn ? "Signing in..." : "Sign in with Google"}
          </button>
          {signInError ? <p className="error-text">Sign-in failed: {signInError}</p> : null}
        </section>

        <WorkflowRibbon
          activeTab={activeWorkflowTab}
          canOpenChapters={selectedTextbookId !== null}
          canOpenSections={selectedChapterId !== null}
          onSelectTab={(tab) => {
            setActiveWorkflowTab(tab);
            setExpandedTile(tab);
          }}
        />

        {renderWorkflowPanel()}
      </main>
    </div>
  );
}
