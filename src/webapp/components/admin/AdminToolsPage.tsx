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

import { ContentBrowser, ModerationQueue, UserManagement } from "./index";

type AdminTab = "users" | "moderation" | "browser" | "system";

interface AdminToolsPageProps {
  currentUserEmail: string | null;
  onBack: () => void;
}

export function AdminToolsPage({ currentUserEmail, onBack }: AdminToolsPageProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AdminTab>("users");

  function renderTabContent(): React.JSX.Element {
    switch (activeTab) {
      case "users":
        return <UserManagement />;
      case "moderation":
        return <ModerationQueue />;
      case "browser":
        return <ContentBrowser />;
      case "system":
        return (
          <section className="admin-section">
            <h3>System Tools</h3>
            <p className="admin-note">
              System-level utilities (bulk operations, DB migrations, feature flags)
              will be added here in a future release.
            </p>
          </section>
        );
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
            { id: "users", label: "User Management" },
            { id: "moderation", label: "Moderation Queue" },
            { id: "browser", label: "Content Browser" },
            { id: "system", label: "System Tools" },
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
