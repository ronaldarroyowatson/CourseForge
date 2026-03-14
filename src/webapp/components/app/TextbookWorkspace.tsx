import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import type { Chapter, Section, Textbook } from "../../../core/models";
import { initDB } from "../../../core/services/db";
import { getAll as getAllTextbooks } from "../../../core/services/repositories/textbookRepository";
import { signOutCurrentUser } from "../../../firebase/auth";
import { useRepositories } from "../../hooks/useRepositories";
import { useAuthStore } from "../../store/authStore";
import { useUIStore } from "../../store/uiStore";
import { ChapterForm } from "../chapters/ChapterForm";
import { ChapterList } from "../chapters/ChapterList";
import { SectionContentPanel, type ContentPanelTab } from "../content/SectionContentPanel";
import { AccordionTile } from "../layout/AccordionTile";
import { Header } from "../layout/Header";
import type { WorkflowTab } from "../layout/WorkflowRibbon";
import { SectionForm } from "../sections/SectionForm";
import { SectionList } from "../sections/SectionList";
import { SectionNavigationBar } from "../sections/SectionNavigationBar";
import { SettingsPage } from "../settings/SettingsPage";
import { TextbookForm } from "../textbooks/TextbookForm";
import { TextbookList } from "../textbooks/TextbookList";

const AdminToolsPage = React.lazy(async () => {
  const module = await import("../admin/AdminToolsPage");
  return { default: module.AdminToolsPage };
});

interface TextbookWorkspaceProps {
  showAdminPage?: boolean;
  showSettingsPage?: boolean;
}

export function TextbookWorkspace({ showAdminPage = false, showSettingsPage = false }: TextbookWorkspaceProps): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ id: string; chapterId?: string; sectionId?: string; contentTab?: string }>();
  const currentUserId = useAuthStore((state) => state.userId);
  const currentUserEmail = useAuthStore((state) => state.userEmail);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const { syncStatus, syncMessage } = useUIStore();
  const { fetchChaptersByTextbookId, fetchSectionsByChapterId } = useRepositories();

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
  const [chapters, setChapters] = React.useState<Chapter[]>([]);
  const [sections, setSections] = React.useState<Section[]>([]);
  const [activeContentPanel, setActiveContentPanel] = React.useState<ContentPanelTab>("vocab");
  const [workflowNotice, setWorkflowNotice] = React.useState<string | null>(null);
  const [activeWorkflowTab, setActiveWorkflowTab] = React.useState<WorkflowTab>("textbook");
  const [expandedTile, setExpandedTile] = React.useState<WorkflowTab | null>("textbook");
  const sectionPanelRef = React.useRef<HTMLDivElement | null>(null);

  const selectedChapter = React.useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) ?? null,
    [chapters, selectedChapterId]
  );
  const selectedSection = React.useMemo(
    () => sections.find((section) => section.id === selectedSectionId) ?? null,
    [sections, selectedSectionId]
  );
  const selectedSectionIndex = React.useMemo(
    () => sections.findIndex((section) => section.id === selectedSectionId),
    [sections, selectedSectionId]
  );
  const previousSection = selectedSectionIndex > 0 ? sections[selectedSectionIndex - 1] : null;
  const nextSection = selectedSectionIndex >= 0 && selectedSectionIndex < sections.length - 1
    ? sections[selectedSectionIndex + 1]
    : null;

  function scrollToSectionPanel(): void {
    window.requestAnimationFrame(() => {
      sectionPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function expandSection(sectionId: string, workflow: "sections" | "content" = "sections"): void {
    setSelectedSectionId(sectionId);
    setExpandedTile(workflow === "sections" ? "sections" : "content");
    setActiveWorkflowTab(workflow);
    setWorkflowNotice(null);
    scrollToSectionPanel();
  }

  function toContentPanel(value: string | undefined): ContentPanelTab {
    if (value === "equations") {
      return "equations";
    }

    if (value === "concepts") {
      return "concepts";
    }

    return "vocab";
  }

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
    if (showAdminPage || showSettingsPage) {
      return;
    }

    if (!params.id) {
      setSelectedTextbookId(null);
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setChapters([]);
      setSections([]);
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
    if (params.chapterId) {
      setSelectedChapterId(params.chapterId);

      if (params.sectionId) {
        setSelectedSectionId(params.sectionId);
        if (params.contentTab) {
          setActiveContentPanel(toContentPanel(params.contentTab));
          setActiveWorkflowTab("content");
          setExpandedTile("content");
        } else {
          setActiveWorkflowTab("sections");
          setExpandedTile("sections");
        }
      } else {
        setSelectedSectionId(null);
        setActiveWorkflowTab("sections");
        setExpandedTile("sections");
      }
      return;
    }

    setSelectedChapterId(null);
    setSelectedSectionId(null);
    setActiveWorkflowTab("chapters");
    setExpandedTile("chapters");
  }, [params.id, params.chapterId, params.sectionId, params.contentTab, isLoadingTextbooks, navigate, showAdminPage, showSettingsPage, textbooks]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadChapters(): Promise<void> {
      if (!selectedTextbookId) {
        setChapters([]);
        return;
      }

      const rows = await fetchChaptersByTextbookId(selectedTextbookId);
      if (!isMounted) {
        return;
      }

      const sortedRows = [...rows].sort((left, right) => left.index - right.index);
      setChapters(sortedRows);
      if (selectedChapterId && !sortedRows.some((chapter) => chapter.id === selectedChapterId)) {
        setSelectedChapterId(null);
        setSelectedSectionId(null);
      }
    }

    void loadChapters();

    return () => {
      isMounted = false;
    };
  }, [fetchChaptersByTextbookId, selectedTextbookId, selectedChapterId, chapterRefreshKey]);

  React.useEffect(() => {
    let isMounted = true;

    async function loadSections(): Promise<void> {
      if (!selectedChapterId) {
        setSections([]);
        return;
      }

      const rows = await fetchSectionsByChapterId(selectedChapterId);
      if (!isMounted) {
        return;
      }

      const sortedRows = [...rows].sort((left, right) => left.index - right.index);
      setSections(sortedRows);
      if (selectedSectionId && !sortedRows.some((section) => section.id === selectedSectionId)) {
        setSelectedSectionId(null);
      }
    }

    void loadSections();

    return () => {
      isMounted = false;
    };
  }, [fetchSectionsByChapterId, selectedChapterId, selectedSectionId, sectionRefreshKey]);

  React.useEffect(() => {
    if (showAdminPage || showSettingsPage) {
      return;
    }

    let targetPath = "/textbooks";

    if (selectedTextbookId) {
      targetPath = `/textbooks/${selectedTextbookId}`;
    }

    if (selectedTextbookId && selectedChapterId) {
      targetPath = `/textbooks/${selectedTextbookId}/chapters/${selectedChapterId}`;
    }

    if (selectedTextbookId && selectedChapterId && selectedSectionId) {
      targetPath = `/textbooks/${selectedTextbookId}/chapters/${selectedChapterId}/sections/${selectedSectionId}`;

      if (activeWorkflowTab === "content") {
        targetPath = `${targetPath}/${activeContentPanel}`;
      }
    }

    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [activeContentPanel, activeWorkflowTab, location.pathname, navigate, selectedChapterId, selectedSectionId, selectedTextbookId, showAdminPage, showSettingsPage]);

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

    if (!selectedChapterId && activeWorkflowTab === "content") {
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

  async function handleContinueToSections(): Promise<void> {
    if (!selectedTextbookId) {
      setWorkflowNotice("Select a textbook first.");
      return;
    }

    const textbookChapters = await fetchChaptersByTextbookId(selectedTextbookId);
    const sortedChapters = [...textbookChapters].sort((left, right) => left.index - right.index);

    if (sortedChapters.length === 0) {
      setSelectedChapterId(null);
      setSelectedSectionId(null);
      setActiveWorkflowTab("chapters");
      setExpandedTile("chapters");
      setWorkflowNotice("Create a chapter first, then continue to sections.");
      return;
    }

    const chapterToUse = sortedChapters.find((chapter) => chapter.id === selectedChapterId) ?? sortedChapters[0];
    setSelectedChapterId(chapterToUse.id);

    const chapterSections = await fetchSectionsByChapterId(chapterToUse.id);
    const sortedSections = [...chapterSections].sort((left, right) => left.index - right.index);

    if (sortedSections.length === 0) {
      setSelectedSectionId(null);
      setActiveWorkflowTab("sections");
      setExpandedTile("sections");
      scrollToSectionPanel();
      setWorkflowNotice("Create a section for this chapter to continue to content panels.");
      return;
    }

    expandSection(sortedSections[0].id, "sections");
  }

  function handleChapterSaved(chapterId: string): void {
    setChapterRefreshKey((current) => current + 1);
    setSelectedChapterId(chapterId);
    setSelectedSectionId(null);
    setActiveWorkflowTab("sections");
    setExpandedTile("sections");
  }

  function handleSectionSaved(sectionId: string): void {
    setSectionRefreshKey((current) => current + 1);
    expandSection(sectionId, "sections");
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

  function handleSectionSelected(id: string | null): void {
    if (!id) {
      setSelectedSectionId(null);
      setActiveWorkflowTab("sections");
      setExpandedTile("sections");
      return;
    }

    expandSection(id, "sections");
  }

  function handleSectionSelectedById(id: string): void {
    expandSection(id, "sections");
  }

  function handleContentSectionSelectedById(id: string): void {
    expandSection(id, "content");
  }

  function handleOpenContent(panel: ContentPanelTab): void {
    setActiveContentPanel(panel);
    setActiveWorkflowTab("content");
    setExpandedTile("content");
    setWorkflowNotice(null);
  }

  function handleBackToSections(): void {
    setActiveWorkflowTab("sections");
    setExpandedTile("sections");
    scrollToSectionPanel();
  }

  function handleFallbackChapterSelected(id: string | null): void {
    setSelectedChapterId(id);
    setSelectedSectionId(null);

    if (id) {
      setActiveWorkflowTab("sections");
      return;
    }

    setActiveWorkflowTab(selectedTextbookId ? "chapters" : "textbook");
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

  const workflowOrder: WorkflowTab[] = ["textbook", "chapters", "sections", "content"];

  function canOpenTab(tab: WorkflowTab): boolean {
    if (tab === "textbook") {
      return true;
    }

    if (tab === "chapters") {
      return selectedTextbookId !== null;
    }

    if (tab === "sections") {
      return selectedChapterId !== null;
    }

    return selectedSectionId !== null;
  }

  function toggleWorkflowTab(tab: WorkflowTab): void {
    if (!canOpenTab(tab)) {
      return;
    }

    if (activeWorkflowTab !== tab) {
      setActiveWorkflowTab(tab);
      setExpandedTile(tab);
      return;
    }

    setExpandedTile((current) => current === tab ? null : tab);
  }

  function getCardSummary(tab: WorkflowTab): string {
    if (tab === "textbook") {
      return selectedTextbookId
        ? "A textbook is selected for onboarding."
        : "Create or select a textbook to continue.";
    }

    if (tab === "chapters") {
      return selectedTextbookId
        ? "Add the next chapter for the selected textbook."
        : "Select a textbook to unlock chapter setup.";
    }

    if (tab === "sections") {
      return selectedChapterId
        ? "Add the next section for the selected chapter."
        : "Select a chapter to unlock section setup.";
    }

    return selectedSectionId
      ? "Add vocab, equations, concepts, and key ideas for the selected section."
      : "Select a section to unlock content capture.";
  }

  function renderWorkflowCardBody(tab: WorkflowTab): React.JSX.Element {
    if (tab === "textbook") {
      return (
        <div className="panel-grid">
          <TextbookForm onSaved={handleTextbookSaved} />
          <TextbookList
            textbooks={textbooks}
            isLoading={isLoadingTextbooks}
            loadError={textbookLoadError}
            selectedTextbookId={selectedTextbookId}
            onSelectTextbook={handleTextbookSelected}
            onContinueToSections={() => {
              void handleContinueToSections();
            }}
            onDeleted={handleTextbookDeleted}
            onRefresh={() => setTextbookRefreshKey((current) => current + 1)}
          />
        </div>
      );
    }

    if (tab === "chapters") {
      if (!selectedTextbookId) {
        return <p className="workflow-card-placeholder">Select a textbook to begin adding chapters.</p>;
      }

      return (
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
      );
    }

    if (tab === "sections") {
      if (!selectedChapterId) {
        return <p className="workflow-card-placeholder">Select a chapter to begin adding sections.</p>;
      }

      return (
        <div ref={sectionPanelRef} className="panel-grid">
          <SectionNavigationBar
            selectedSection={selectedSection}
            previousSection={previousSection}
            nextSection={nextSection}
            onSelectSection={handleSectionSelectedById}
            onOpenContent={handleOpenContent}
          />
          <SectionForm
            selectedChapterId={selectedChapterId}
            refreshKey={sectionRefreshKey}
            onSaved={handleSectionSaved}
          />
          <SectionList
            selectedChapterId={selectedChapterId}
            selectedSectionId={selectedSectionId}
            onSelectSection={handleSectionSelected}
            refreshKey={sectionRefreshKey}
          />
        </div>
      );
    }

    if (!selectedTextbookId || !selectedChapterId) {
      return <p className="workflow-card-placeholder">Select a chapter and section to open content panels.</p>;
    }

    return (
      <SectionContentPanel
        selectedTextbookId={selectedTextbookId}
        selectedChapterId={selectedChapterId}
        selectedSectionId={selectedSectionId}
        selectedChapter={selectedChapter}
        selectedSection={selectedSection}
        previousSection={previousSection}
        nextSection={nextSection}
        activePanel={activeContentPanel}
        onSelectChapter={handleFallbackChapterSelected}
        onSelectSection={handleSectionSelected}
        onSelectSectionById={handleContentSectionSelectedById}
        onBackToSections={handleBackToSections}
        onSelectPanel={handleOpenContent}
      />
    );
  }

  function renderWorkflowPanel(): React.JSX.Element {
    const activeIndex = workflowOrder.indexOf(activeWorkflowTab);

    return (
      <div className="workflow-card-stack" aria-label="Onboarding workflow cards">
        {workflowOrder.map((tab, index) => {
          const isActive = index === activeIndex;
          const isPeekPrevious = index === activeIndex - 1;
          const isPeekNext = index === activeIndex + 1;

          const positionClass = isActive
            ? "workflow-card workflow-card--active"
            : isPeekPrevious
              ? "workflow-card workflow-card--peek-prev"
              : isPeekNext
                ? "workflow-card workflow-card--peek-next"
                : "workflow-card workflow-card--hidden";

          return (
            <AccordionTile
              key={tab}
              title=""
              summary=""
              isExpanded={isActive && expandedTile === tab}
              onToggle={() => toggleWorkflowTab(tab)}
              className={positionClass}
              disabled={!canOpenTab(tab)}
            >
              {renderWorkflowCardBody(tab)}
            </AccordionTile>
          );
        })}
      </div>
    );
  }

  return (
    <div className="app-shell">
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
        ) : showSettingsPage ? (
          <SettingsPage
            onBack={() => {
              navigate("/textbooks");
            }}
          />
        ) : (
          <>
            <section className="placeholder-panel">
              <h2>Onboarding Workflow</h2>
              <p>Set up textbooks, chapters, and sections in sequence, then continue into section content capture.</p>
              <p><strong>Auth:</strong> {currentUserEmail ?? (currentUserId ? `UID: ${currentUserId}` : "Unknown user")}</p>
              {workflowNotice ? <p className="sync-indicator">{workflowNotice}</p> : null}
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

            {renderWorkflowPanel()}
          </>
        )}
      </main>
    </div>
  );
}
