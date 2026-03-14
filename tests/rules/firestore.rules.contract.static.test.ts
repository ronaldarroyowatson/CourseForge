// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRulesText(): string {
  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  return readFileSync(rulesPath, "utf8");
}

describe("Firestore rules static contract", () => {
  it("keeps user-scoped legacy subcollections explicitly blocked", () => {
    const rules = readRulesText();

    expect(rules).toMatch(/match \/users\/\{uid\}/);
    expect(rules).toMatch(/match \/textbooks\/\{docId\}[\s\S]*allow write:\s*if false;/);
    expect(rules).toMatch(/match \/chapters\/\{docId\}[\s\S]*allow write:\s*if false;/);
    expect(rules).toMatch(/match \/sections\/\{docId\}[\s\S]*allow write:\s*if false;/);
    expect(rules).toMatch(/match \/vocabTerms\/\{docId\}[\s\S]*allow write:\s*if false;/);
  });

  it("keeps canonical hierarchy ownership gates in place", () => {
    const rules = readRulesText();

    expect(rules).toMatch(/match \/textbooks\/\{textbookId\}/);
    expect(rules).toMatch(/match \/chapters\/\{chapterId\}/);
    expect(rules).toMatch(/match \/sections\/\{sectionId\}/);
    expect(rules).toMatch(/match \/vocab\/\{vocabId\}/);
    expect(rules).toMatch(/match \/equations\/\{equationId\}/);
    expect(rules).toMatch(/match \/concepts\/\{conceptId\}/);
    expect(rules).toMatch(/match \/keyIdeas\/\{keyIdeaId\}/);
    expect(rules).toMatch(/allow read:\s*if isOwnerRead\(\);/);
    expect(rules).toMatch(/allow write:\s*if isOwner\(\) \|\| isAdmin\(\);/);
  });

  it("retains catch-all deny as final fallback", () => {
    const rules = readRulesText();

    expect(rules).toMatch(/match \/\{document=\*\*\}/);
    expect(rules).toMatch(/allow read:\s*if false;/);
    expect(rules).toMatch(/allow write:\s*if false;/);
  });
});
