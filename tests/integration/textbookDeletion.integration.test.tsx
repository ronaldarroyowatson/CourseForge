import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Textbook } from "../../src/core/models";
import { TextbookWorkspace } from "../../src/webapp/components/app/TextbookWorkspace";
import { TextbookList } from "../../src/webapp/components/textbooks/TextbookList";

const textbookRepositoryMocks = vi.hoisted(() => ({
  getAllTextbooks: vi.fn<() => Promise<Textbook[]>>(async () => []),
}));

const repositoryHookMocks = vi.hoisted(() => ({
  removeTextbook: vi.fn<(id: string) => Promise<void>>(async () => undefined),
  toggleTextbookFavorite: vi.fn<(id: string, isFavorite: boolean) => Promise<void>>(async () => undefined),
  toggleTextbookArchive: vi.fn<(id: string, isArchived: boolean) => Promise<void>>(async () => undefined),
  fetchChaptersByTextbookId: vi.fn<(textbookId: string) => Promise<any[]>>(async () => []),
  fetchSectionsByChapterId: vi.fn<(chapterId: string) => Promise<any[]>>(async () => []),
}));

vi.mock("../../src/core/services/db", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/services/db")>("../../src/core/services/db");
  return {
    ...actual,
    initDB: vi.fn(async () => undefined),
  };
});

vi.mock("../../src/core/services/repositories/textbookRepository", () => ({
  getAll: () => textbookRepositoryMocks.getAllTextbooks(),
  listTextbooks: async () => {
    const rows = await textbookRepositoryMocks.getAllTextbooks();
    return rows.filter((textbook) => !textbook.isDeleted);
  },
}));

vi.mock("../../src/webapp/hooks/useRepositories", () => ({
  useRepositories: () => ({
    removeTextbook: repositoryHookMocks.removeTextbook,
    toggleTextbookFavorite: repositoryHookMocks.toggleTextbookFavorite,
    toggleTextbookArchive: repositoryHookMocks.toggleTextbookArchive,
    fetchChaptersByTextbookId: repositoryHookMocks.fetchChaptersByTextbookId,
    fetchSectionsByChapterId: repositoryHookMocks.fetchSectionsByChapterId,
  }),
}));

vi.mock("../../src/webapp/hooks/useGlobalShortcuts", () => ({
  useGlobalShortcuts: vi.fn(),
}));

vi.mock("../../src/webapp/components/layout/Header", () => ({
  Header: () => <div>HEADER</div>,
}));

vi.mock("../../src/webapp/components/layout/AccordionTile", () => ({
  AccordionTile: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../src/webapp/components/textbooks/TextbookForm", () => ({
  TextbookForm: () => <div>TEXTBOOK_FORM</div>,
}));

vi.mock("../../src/webapp/components/chapters/ChapterForm", () => ({
  ChapterForm: () => <div>CHAPTER_FORM</div>,
}));

vi.mock("../../src/webapp/components/chapters/ChapterList", () => ({
  ChapterList: () => <div>CHAPTER_LIST</div>,
}));

vi.mock("../../src/webapp/components/sections/SectionForm", () => ({
  SectionForm: () => <div>SECTION_FORM</div>,
}));

vi.mock("../../src/webapp/components/sections/SectionList", () => ({
  SectionList: () => <div>SECTION_LIST</div>,
}));

vi.mock("../../src/webapp/components/sections/SectionNavigationBar", () => ({
  SectionNavigationBar: () => <div>SECTION_NAVIGATION</div>,
}));

vi.mock("../../src/webapp/components/content/SectionContentPanel", () => ({
  SectionContentPanel: () => <div>SECTION_CONTENT</div>,
}));

vi.mock("../../src/webapp/components/content/PowerPointWorkspaceCard", () => ({
  PowerPointWorkspaceCard: () => <div>POWERPOINT_WORKSPACE</div>,
}));

vi.mock("../../src/webapp/components/settings/SettingsPage", () => ({
  SettingsPage: () => <div>SETTINGS_PAGE</div>,
}));

vi.mock("../../src/firebase/auth", () => ({
  signOutCurrentUser: vi.fn(async () => undefined),
}));

function buildTextbook(id: string, overrides: Partial<Textbook> = {}): Textbook {
  const now = "2026-04-26T00:00:00.000Z";
  return {
    id,
    sourceType: "manual",
    originalLanguage: "en",
    title: `Textbook ${id}`,
    grade: "8",
    subject: "Science",
    edition: "1",
    publicationYear: 2025,
    isbnRaw: "",
    isbnNormalized: "",
    createdAt: now,
    updatedAt: now,
    lastModified: now,
    pendingSync: false,
    source: "local",
    isFavorite: false,
    isArchived: false,
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function TextbookListHarness(): React.JSX.Element {
  const [textbooks, setTextbooks] = React.useState<Textbook[]>([
    buildTextbook("tb-live", { title: "Live Biology" }),
  ]);

  return (
    <TextbookList
      textbooks={textbooks}
      isLoading={false}
      loadError={null}
      selectedTextbookId={null}
      onSelectTextbook={() => undefined}
      onContinueToSections={() => undefined}
      onDeleted={(id) => setTextbooks((current) => current.filter((textbook) => textbook.id !== id))}
      onRefresh={() => undefined}
    />
  );
}

describe("textbook deletion integration", () => {
  beforeEach(() => {
    repositoryHookMocks.removeTextbook.mockReset();
    repositoryHookMocks.removeTextbook.mockResolvedValue(undefined);
    repositoryHookMocks.toggleTextbookFavorite.mockClear();
    repositoryHookMocks.toggleTextbookArchive.mockClear();
    repositoryHookMocks.fetchChaptersByTextbookId.mockClear();
    repositoryHookMocks.fetchSectionsByChapterId.mockClear();
    textbookRepositoryMocks.getAllTextbooks.mockReset();
    textbookRepositoryMocks.getAllTextbooks.mockResolvedValue([]);
    window.history.pushState({}, "", "/textbooks");
  });

  it("removes a deleted textbook from the UI immediately after clicking delete", async () => {
    const deferred = createDeferred<void>();
    repositoryHookMocks.removeTextbook.mockReturnValueOnce(deferred.promise);

    render(<TextbookListHarness />);

    expect(screen.getByText("Live Biology")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("Live Biology")).not.toBeInTheDocument();

    deferred.resolve(undefined);
    await deferred.promise;
  });

  it("does not rehydrate deleted textbooks on reload when cached rows are marked deleted", async () => {
    textbookRepositoryMocks.getAllTextbooks.mockResolvedValueOnce([
      buildTextbook("tb-deleted", { title: "Deleted Chemistry", isDeleted: true }),
      buildTextbook("tb-active", { title: "Active Biology" }),
    ]);

    render(
      <MemoryRouter initialEntries={["/textbooks"]}>
        <TextbookWorkspace />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Active Biology")).toBeInTheDocument();
    });

    expect(screen.queryByText("Deleted Chemistry")).not.toBeInTheDocument();
  });
});