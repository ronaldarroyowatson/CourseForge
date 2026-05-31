import { describe, expect, it } from "vitest";

import { AUTH_PROVIDER_OPTIONS, shouldUseRedirectFlow } from "../../src/firebase/auth";

describe("auth provider availability policy", () => {
  it("keeps Apple deferred while validating active provider set", () => {
    const configuredProviders = AUTH_PROVIDER_OPTIONS
      .map((provider) => provider.id)
      .filter((providerId) => providerId !== "apple");

    expect(configuredProviders).toEqual(["google", "github", "microsoft"]);
    expect(AUTH_PROVIDER_OPTIONS.some((provider) => provider.id === "apple")).toBe(true);
  });

  it("uses redirect flow only for providers that require it", () => {
    expect(shouldUseRedirectFlow("google")).toBe(false);
    expect(shouldUseRedirectFlow("github")).toBe(false);
    expect(shouldUseRedirectFlow("microsoft")).toBe(true);
    expect(shouldUseRedirectFlow("apple")).toBe(true);
  });
});
