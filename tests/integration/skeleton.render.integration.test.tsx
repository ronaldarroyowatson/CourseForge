import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SkeletonButton, SkeletonCard, SkeletonPageLayout, SkeletonText } from "../../src/webapp/components/skeleton/Skeleton";

describe("Structure-aware skeleton components", () => {
  beforeEach(() => {
    window.localStorage.setItem("courseforge.debugLog.enabled", "false");
  });

  it("renders reusable skeleton primitives", () => {
    const { container } = render(
      <div>
        <SkeletonText lines={2} />
        <SkeletonButton />
        <SkeletonCard />
      </div>
    );

    expect(container.querySelectorAll(".cf-skeleton--line").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll(".cf-skeleton--button").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll(".cf-skeleton-card").length).toBe(1);
  });

  it("renders a structure-aware page layout", () => {
    const { container } = render(<SkeletonPageLayout cardCount={4} />);

    expect(screen.getByLabelText("Loading content")).toBeInTheDocument();
    expect(container.querySelectorAll(".cf-skeleton-card")).toHaveLength(4);
  });
});
