import React from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Textbook } from "../../../core/models";
import { initDB } from "../../../core/services/db";
import { getAll as getAllTextbooks } from "../../../core/services/repositories/textbookRepository";
import { signOutCurrentUser } from "../../../firebase/auth";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import { ChapterForm } from "../chapters/ChapterForm";
import { ChapterList } from "../chapters/ChapterList";
import { AccordionTile } from "../layout/AccordionTile";
import { Header } from "../layout/Header";
import { Sidebar } from "../layout/Sidebar";
import { WorkflowRibbon, type WorkflowTab } from "../layout/WorkflowRibbon";
import { SectionForm } from "../sections/SectionForm";
import { SectionList } from "../sections/SectionList";
import { TextbookForm } from "../textbooks/TextbookForm";
import { TextbookList } from "../textbooks/TextbookList";

const AdminToolsPage = React.lazy(async () => {
  const module = await import("../admin/AdminToolsPage");
  return { default: module.AdminToolsPage };
});

interface TextbookWorkspaceProps {
  showAdminPage?: boolean;
}

export function TextbookWorkspace({ showAdminPage = false }: TextbookWorkspaceProps): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const currentUserId = useAuthStore((state) => state.userId);
  const currentUserEmail = useAuthStore((state) => state.userEmail);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const { syncStatus, syncMessage } = useUIStore();

  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState<string | null>(null);
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
    if (!params.id) {
      setSelectedTextbookId(null);
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
      return;
    }

    if (isLoadingTextbooks) {
      return;
    }

    const matchingTextbook = textbooks.find((textbook) => textbook.id === params.id);
    if (!matchingTextbook) {
      navigate("/textbooks", { replace: true });
      return;
    }

    setSelectedTextbookId(matchingTextbook.id);
    setSelectedChapterId(null);
    setSelectedSectionId(null);
    setActiveWorkflowTab("chapters");
    setExpandedTile("chapters");
  }, [params.id, isLoadingTextbooks, navigate, textbooks]);

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
      navigate("/textbooks", { replace: true });
    }
  }, [navigate, selectedTextbookId, textbooks]);

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
    navigate("/textbooks", { replace: true });
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
    navigate(`/textbooks/${id}`);
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
      navigate("/textbooks", { replace: true });
      setSelectedTextbookId(null);
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("textbook");
      setExpandedTile("textbook");
    }
  }

  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      await signOutCurrentUser();
      navigate("/login", { replace: true });
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "Unable to sign out.");
    } finally {
      setIsSigningOut(false);
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
              onRefresh={() => setTextbookRefreshKey((current) => current + 1)}
            />
          </div>
        </AccordionTile>
      );
    }

    if (activeWorkflowTab === "chapters" && selectedTextbookId) {
      return (
        <AccordionTile
          title="Chapters"
          summary="Add the next chapter for the selected textbook."
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

        {showAdminPage ? (
          <React.Suspense fallback={<section className="placeholder-panel"><p>Loading admin tools...</p></section>}>
            <AdminToolsPage
              currentUserEmail={currentUserEmail}
              onBack={() => {
                navigate("/textbooks");
              }}
            />
          </React.Suspense>
        ) : (
          <>
            <section className="placeholder-panel">
              <h2>Onboarding Workflow</h2>
              <p>Set up textbooks, chapters, and sections in sequence, then continue into section content capture.</p>
              <p><strong>Auth:</strong> {currentUserEmail ?? (currentUserId ? `UID: ${currentUserId}` : "Unknown user")}</p>
              {syncStatus === "syncing" ? <p className="sync-indicator">Syncing...</p> : null}
              {syncStatus === "synced" ? <p className="sync-indicator sync-indicator--synced">Synced ✓</p> : null}
              {syncStatus === "error" && syncMessage ? <p className="error-text sync-indicator">Sync issue: {syncMessage}</p> : null}
              <button type="button" onClick={() => { void handleSignOut(); }} disabled={isSigningOut}>
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  className="btn-secondary admin-open-btn"
                  onClick={() => {
                    navigate("/admin");
                  }}
                >
                  Open Admin Tools
                </button>
              ) : null}
              {signOutError ? <p className="error-text">Sign-out failed: {signOutError}</p> : null}
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
          </>
        )}
      </main>
    </div>
  );
}
