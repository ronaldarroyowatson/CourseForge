import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFunctionsSource(): string {
  const filePath = path.resolve(process.cwd(), "functions/src/index.ts");
  return readFileSync(filePath, "utf8");
}

function readEntitiesSource(): string {
  const filePath = path.resolve(process.cwd(), "src/core/models/entities.ts");
  return readFileSync(filePath, "utf8");
}

describe("Functions backend callable contract verification", () => {
  it("declares callable exports with consistent success envelope", () => {
    const source = readFunctionsSource();

    const callableExports = [
      "setUserAdminStatus",
      "listAdminUsers",
      "getModerationQueue",
      "updateModerationStatus",
      "archiveAdminContent",
      "softDeleteAdminContent",
      "searchAdminContent",
      "updateAdminContent",
      "getPremiumUsageReport",
      "managePremiumUser",
      "getCurrentPremiumUsage",
      "generateTieredQuestionVariations",
    ];

    for (const callableExport of callableExports) {
      expect(source).toContain(`export const ${callableExport} = onCall`);
    }

    expect(source).toContain("function success<T>(message: string, data: T): CallableResult<T>");
    expect(source).toContain("return { success: true, message, data };");
  });

  it("contains explicit admin guard and missing-auth mutation guard", () => {
    const source = readFunctionsSource();

    expect(source).toContain("function assertAdmin(authData");
    expect(source).toContain("throw new HttpsError(\"unauthenticated\"");
    expect(source).toContain("throw new HttpsError(\"permission-denied\"");
  });
});

describe("Functions moderation/admin shaping contracts", () => {
  it("includes moderation queue shaping across section-scoped collections", () => {
    const source = readFunctionsSource();

    expect(source).toContain("const SUPPORTED_COLLECTIONS = [\"textbooks\", \"chapters\", \"sections\", \"vocab\", \"equations\", \"concepts\", \"keyIdeas\"]");
    expect(source).toContain("firestore.collectionGroup(collectionName).where(\"status\", \"==\", \"submitted\")");
    expect(source).toContain("function buildModerationItem(");
    expect(source).toContain("items.sort((left, right)");
  });

  it("rejects unsupported moderation paths via parseDocPath mutation guard", () => {
    const source = readFunctionsSource();

    expect(source).toContain("function parseDocPath(docPath: string)");
    expect(source).toContain("throw new HttpsError(\"invalid-argument\", \"Unsupported document path.\")");
    expect(source).not.toContain("parts[6] === \"unsupported\"");
  });
});

describe("Functions section-scoped processing and schema agreement", () => {
  it("whitelists equations/concepts/keyIdeas update fields and blocks tampered ownership fields", () => {
    const source = readFunctionsSource();

    expect(source).toContain("equations: [\"name\", \"latex\", \"description\", \"status\"]");
    expect(source).toContain("concepts: [\"name\", \"explanation\", \"status\"]");
    expect(source).toContain("keyIdeas: [\"text\", \"status\"]");

    expect(source).not.toContain("equations: [\"ownerId\"");
    expect(source).not.toContain("concepts: [\"ownerId\"");
    expect(source).not.toContain("keyIdeas: [\"ownerId\"");
  });

  it("aligns server shaping with client entity schema fields", () => {
    const functionsSource = readFunctionsSource();
    const entitiesSource = readEntitiesSource();

    expect(entitiesSource).toContain("export interface Equation");
    expect(entitiesSource).toContain("name: string;");
    expect(entitiesSource).toContain("latex: string;");
    expect(entitiesSource).toContain("export interface Concept");
    expect(entitiesSource).toContain("explanation?: string;");
    expect(entitiesSource).toContain("export interface KeyIdea");
    expect(entitiesSource).toContain("text: string;");

    expect(functionsSource).toMatch(/case\s+"equations":\s*return typeof data\.name === "string" \? data\.name : fallbackId;/);
    expect(functionsSource).toMatch(/case\s+"concepts":\s*return typeof data\.name === "string" \? data\.name : fallbackId;/);
    expect(functionsSource).toMatch(/case\s+"keyIdeas":\s*return typeof data\.text === "string" \? data\.text : fallbackId;/);

    expect(functionsSource).toMatch(/case\s+"equations":\s*return typeof data\.description === "string" \? data\.description : undefined;/);
    expect(functionsSource).toMatch(/case\s+"concepts":\s*return typeof data\.explanation === "string" \? data\.explanation : undefined;/);
    expect(functionsSource).toMatch(/case\s+"keyIdeas":\s*return typeof data\.text === "string" \? data\.text : undefined;/);
  });
});

describe("Functions premium usage admin flow contracts", () => {
  it("contains usage monitoring and freeze/reset actions", () => {
    const source = readFunctionsSource();

    expect(source).toContain("interface PremiumUsageState");
    expect(source).toContain("freezePremium: boolean;");
    expect(source).toContain("export const getPremiumUsageReport = onCall");
    expect(source).toContain("export const managePremiumUser = onCall");
    expect(source).toContain("[\"freeze\", \"unfreeze\", \"resetDaily\", \"resetWeekly\", \"resetMonthly\"]");
  });

  it("keeps unsupported premium actions blocked (false-positive mutation guard)", () => {
    const source = readFunctionsSource();

    expect(source).toContain("throw new HttpsError(\"invalid-argument\", \"Unsupported premium usage action.\")");
  });
});
