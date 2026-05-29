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
    // Must NOT use the index-requiring .where filter on the collection group.
    expect(source).not.toContain("collectionGroup(\"syncUsage\").where(\"dateKey\", \"==\", todayKey)");
    // Must filter dateKey in memory instead.
    expect(source).toContain("if (typeof data.dateKey !== \"string\" || data.dateKey !== todayKey) {");
    // The collectionGroup query on syncUsage requires a COLLECTION_GROUP_ASC index that may
    // not be present in production (causes FAILED_PRECONDITION). It MUST be inside a try/catch
    // so that a missing index cannot crash the function and discard all other stats.
    expect(source).toContain("collectionGroup(\"syncUsage\").get()");
    expect(source).toContain("[super-admin] syncUsage collection group query failed");
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