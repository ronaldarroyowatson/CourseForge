import { testEscapeXmlEscapesReservedCharacters } from "./xml.escapeXml.test";
import {
  testFormatCurriculumXmlEscapesAndOmitsOptionals,
  testFormatCurriculumXmlRendersSchemaShape,
} from "./xml.formatXml.test";
import {
  testExportChapterXmlRejectsUnknownId,
  testExportChapterXmlScopesToSingleChapter,
  testExportTextbookXmlRejectsBlankId,
  testExportSectionXmlScopesToSingleSection,
  testExportTextbookXmlIncludesAllHierarchy,
} from "./xml.exportXml.integration.test";

function runTest(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`PASS: ${name}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

async function runAsyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    // eslint-disable-next-line no-console
    console.log(`PASS: ${name}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${name}`);
    throw error;
  }
}

runTest("escapeXml escapes reserved characters", testEscapeXmlEscapesReservedCharacters);
runTest("formatCurriculumXml renders schema shape", testFormatCurriculumXmlRendersSchemaShape);
runTest(
  "formatCurriculumXml escapes and omits optional tags",
  testFormatCurriculumXmlEscapesAndOmitsOptionals
);

await runAsyncTest(
  "exportTextbookXml includes full hierarchy",
  testExportTextbookXmlIncludesAllHierarchy
);
await runAsyncTest("exportChapterXml scopes to chapter", testExportChapterXmlScopesToSingleChapter);
await runAsyncTest("exportSectionXml scopes to section", testExportSectionXmlScopesToSingleSection);
await runAsyncTest("exportTextbookXml rejects blank ID", testExportTextbookXmlRejectsBlankId);
await runAsyncTest("exportChapterXml rejects unknown ID", testExportChapterXmlRejectsUnknownId);
