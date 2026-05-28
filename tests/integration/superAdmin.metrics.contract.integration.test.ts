import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFunctionsSource(): string {
  const filePath = path.resolve(process.cwd(), "functions/src/index.ts");
  return readFileSync(filePath, "utf8");
}

function readSuperAdminPageSource(): string {
  const filePath = path.resolve(process.cwd(), "src/webapp/components/admin/SuperAdminPage.tsx");
  return readFileSync(filePath, "utf8");
}

describe("Super admin metrics backend contracts", () => {
  it("uses top-level textbook totals and avoids syncUsage index-sensitive where filter", () => {
    const source = readFunctionsSource();

    expect(source).toContain("firestore.collection(\"textbooks\").count().get()");
    expect(source).toContain("const syncUsageSnapshot = await firestore.collectionGroup(\"syncUsage\").get();");
    expect(source).toContain("if (typeof data.dateKey !== \"string\" || data.dateKey !== todayKey) {");
    expect(source).not.toContain("collectionGroup(\"syncUsage\").where(\"dateKey\", \"==\", todayKey)");
  });

  it("loads promotion requests without composite-index dependency", () => {
    const source = readFunctionsSource();

    expect(source).toContain("firestore.collection(\"schoolAdminPromotionRequests\").limit(600).get()");
    expect(source).toContain(".filter((row) => status === \"all\" || row.status === status)");
    expect(source).toContain(".sort((left, right) => (right.createdAt ?? \"\").localeCompare(left.createdAt ?? \"\"))");
  });
});

describe("Super admin dashboard frontend contracts", () => {
  it("keeps partial dashboard data visible when one callable fails", () => {
    const source = readSuperAdminPageSource();

    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("dashboard partial load failure");
    expect(source).toContain("Some dashboard data failed to load");
  });
});