import React from "react";

import { logDesignSystemDebugEvent } from "../../../core/services/designSystemService";

interface SkeletonTextProps {
  lines?: number;
}

export function SkeletonText({ lines = 3 }: SkeletonTextProps): React.JSX.Element {
  return (
    <div className="cf-skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <span key={`skeleton-line-${index}`} className="cf-skeleton cf-skeleton--line" />
      ))}
    </div>
  );
}

export function SkeletonButton(): React.JSX.Element {
  return <span className="cf-skeleton cf-skeleton--button" aria-hidden="true" />;
}

export function SkeletonCard(): React.JSX.Element {
  return (
    <article className="cf-skeleton-card" aria-hidden="true">
      <span className="cf-skeleton cf-skeleton--title" />
      <SkeletonText lines={2} />
      <div className="cf-skeleton-card__actions">
        <SkeletonButton />
        <SkeletonButton />
      </div>
    </article>
  );
}

export function SkeletonPageLayout({ cardCount = 3 }: { cardCount?: number }): React.JSX.Element {
  React.useEffect(() => {
    void logDesignSystemDebugEvent("Skeleton loader activated.", {
      component: "SkeletonPageLayout",
      cardCount,
    });
  }, [cardCount]);

  return (
    <section className="cf-skeleton-page" aria-label="Loading content">
      <header className="cf-skeleton-page__header">
        <span className="cf-skeleton cf-skeleton--hero" />
        <span className="cf-skeleton cf-skeleton--subhero" />
      </header>
      <div className="cf-skeleton-page__grid">
        {Array.from({ length: cardCount }).map((_, index) => (
          <SkeletonCard key={`skeleton-card-${index}`} />
        ))}
      </div>
    </section>
  );
}
