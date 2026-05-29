/**
 * AdminToolsPage.tsx
 *
 * Admin-only landing page. This component is rendered only after the caller
 * has verified that the current user has the `admin === true` custom claim.
 *
 * Sections:
 *   1. User Management       – list users, promote/revoke admin flag
 *   2. Moderation Queue      – content submitted for review
 *   3. Content Browser       – search/browse all textbooks across users
 *   4. System Tools          – placeholder for future admin utilities
 */
import React, { useState } from "react";

import {
  ContentBrowser,
  CorrectionReviewPanel,
  DebugLoggingPanel,
  GlossaryManagementPanel,
  ModerationQueue,
  PremiumUsagePanel,
  TranslationMemoryPanel,
  TranslationReviewPanel,
  UserManagement,
} from "./index";
import { SchoolAdminPage } from "./SchoolAdminPage";
import { useAuthStore } from "../../store/authStore";

type AdminTab = "users" | "moderation" | "browser" | "premium" | "translations" | "translationReview" | "glossaries" | "debug" | "corrections" | "school";

interface AdminToolsPageProps {
  currentUserEmail: string | null;
  onBack: () => void;
}

export function AdminToolsPage({ currentUserEmail, onBack }: AdminToolsPageProps): React.JSX.Element {
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const isSchoolAdmin = useAuthStore((state) => state.isSchoolAdmin);
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const isSchoolOnlyAdmin = isSchoolAdmin && !isAdmin && !isSuperAdmin;

  const [activeTab, setActiveTab] = useState<AdminTab>(() => isSchoolOnlyAdmin ? "school" : "users");

  function renderTabContent(): React.JSX.Element {
    switch (activeTab) {
      case "users":
        return <UserManagement />;
      case "moderation":
        return <ModerationQueue />;
      case "browser":
        return <ContentBrowser />;
      case "premium":
        return <PremiumUsagePanel />;
      case "translations":
        return <TranslationMemoryPanel />;
      case "translationReview":
        return <TranslationReviewPanel />;
      case "glossaries":
        return <GlossaryManagementPanel />;
      case "debug":
        return <DebugLoggingPanel />;
      case "corrections":
        return <CorrectionReviewPanel />;
      case "school":
        return <SchoolAdminPage onBack={() => {}} embedded />;
    }
  }

  return (
    <div className="admin-shell">
      {/* Admin header bar */}
      <header className="admin-header">
        <div className="admin-header__left">
          <button type="button" onClick={onBack} className="btn-secondary admin-back-btn">
            ← Back to App
          </button>
          <h1 className="admin-title">CourseForge Admin</h1>
        </div>
        <p className="admin-user-label">Signed in as <strong>{currentUserEmail ?? "admin"}</strong></p>
      </header>

      {/* Tab navigation */}
      <nav className="admin-tabs" aria-label="Admin sections">
        {(
          [
            ...(isAdmin || isSuperAdmin ? [
              { id: "users", label: "User Management" },
              { id: "moderation", label: "Moderation Queue" },
              { id: "browser", label: "Content Browser" },
              { id: "premium", label: "Premium Management" },
              { id: "translations", label: "Translation Memory" },
              { id: "translationReview", label: "Translation Review" },
              { id: "glossaries", label: "Glossaries" },
              { id: "debug", label: "Debug Logging" },
              { id: "corrections", label: "Correction Review" },
            ] : []),
            ...(isSchoolAdmin || isAdmin || isSuperAdmin ? [
              { id: "school", label: "School Admin" },
            ] : []),
          ] as { id: AdminTab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={["admin-tab", activeTab === id ? "admin-tab--active" : ""].filter(Boolean).join(" ")}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Active tab content */}
      <main className="admin-content">
        {renderTabContent()}
      </main>
    </div>
  );
}
