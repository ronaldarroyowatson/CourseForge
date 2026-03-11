import { formatCurriculumXml } from "../../src/core/services/xml/formatXml";
import type { TextbookExportNode } from "../../src/core/services/xml/types";

function assertMatch(value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new Error(`Expected pattern not found: ${pattern}`);
  }
}

function assertDoesNotMatch(value: string, pattern: RegExp): void {
  if (pattern.test(value)) {
    throw new Error(`Unexpected pattern found: ${pattern}`);
  }
}

function buildSampleExportNode(): TextbookExportNode {
  return {
    textbook: {
      id: "tb-1",
      title: "Physics & Motion",
      grade: "11",
      subject: "Physics",
      edition: "2023",
      publicationYear: 2023,
      platformUrl: "https://example.com/path?a=1&b=2",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    chapters: [
      {
        chapter: {
          id: "ch-1",
          textbookId: "tb-1",
          index: 1,
          name: "Linear Motion",
          description: "Distance < displacement?",
        },
        sections: [
          {
            section: {
              id: "sec-1",
              chapterId: "ch-1",
              index: 1,
              title: "Displacement & Distance",
              notes: "Teacher notes: compare scalar vs vector.",
            },
            concepts: [
              {
                id: "c-1",
                sectionId: "sec-1",
                name: "Displacement vs Distance",
                explanation: "Displacement is vector; distance is scalar.",
              },
            ],
            equations: [
              {
                id: "e-1",
                sectionId: "sec-1",
                name: "Velocity",
                latex: "v = d/t",
                description: "Average velocity over time.",
              },
            ],
            vocabTerms: [
              {
                id: "v-1",
                sectionId: "sec-1",
                word: "Displacement",
                definition: "Change in position",
                altDefinitions: ["Vector from start to finish", "How far out of place"],
              },
            ],
            keyIdeas: [
              {
                id: "k-1",
                sectionId: "sec-1",
                text: "Velocity has direction.",
              },
            ],
          },
        ],
      },
    ],
  };
}

export function testFormatCurriculumXmlRendersSchemaShape(): void {
  const xml = formatCurriculumXml(buildSampleExportNode(), {
    generatedBy: "CourseForge",
    generatedAt: "2026-03-10T12:00:00Z",
    version: "1.0.0",
  });

  assertMatch(xml, /<curriculum>/);
  assertMatch(xml, /<metadata>/);
  assertMatch(xml, /<generatedBy>CourseForge<\/generatedBy>/);
  assertMatch(xml, /<textbook id="tb-1">/);
  assertMatch(xml, /<chapters>/);
  assertMatch(xml, /<chapter id="ch-1" index="1">/);
  assertMatch(xml, /<sections>/);
  assertMatch(xml, /<section id="sec-1" index="1">/);
  assertMatch(xml, /<concepts>/);
  assertMatch(xml, /<equations>/);
  assertMatch(xml, /<vocab>/);
  assertMatch(xml, /<keyIdeas>/);
}

export function testFormatCurriculumXmlEscapesAndOmitsOptionals(): void {
  const data = buildSampleExportNode();
  data.textbook.platformUrl = undefined;
  data.chapters[0].chapter.description = undefined;
  data.chapters[0].sections[0].section.notes = undefined;

  const xml = formatCurriculumXml(data, {
    generatedBy: "CourseForge",
    generatedAt: "2026-03-10T12:00:00Z",
    version: "1.0.0",
  });

  assertMatch(xml, /<title>Physics &amp; Motion<\/title>/);
  assertMatch(xml, /<title>Displacement &amp; Distance<\/title>/);
  assertDoesNotMatch(xml, /<platformUrl>/);
  assertDoesNotMatch(xml, /<description>Distance &lt; displacement\?<\/description>/);
  assertDoesNotMatch(xml, /<notes>/);
}
