import { escapeXml } from "./escapeXml";
import type { ChapterExportNode, SectionExportNode, TextbookExportNode, XmlMetadata } from "./types";

const INDENT = "  ";

function indent(level: number): string {
  return INDENT.repeat(level);
}

function tag(name: string, value: string, level: number): string {
  return `${indent(level)}<${name}>${escapeXml(value)}</${name}>`;
}

function optionalTag(name: string, value: string | undefined, level: number): string | null {
  if (!value) {
    return null;
  }

  return tag(name, value, level);
}

function formatMetadata(metadata: XmlMetadata, level: number): string[] {
  const generatedBy = metadata.generatedBy ?? "CourseForge";
  const generatedAt = metadata.generatedAt ?? new Date().toISOString();
  const version = metadata.version ?? "1.0.0";

  return [
    `${indent(level)}<metadata>`,
    tag("generatedBy", generatedBy, level + 1),
    tag("generatedAt", generatedAt, level + 1),
    tag("version", version, level + 1),
    `${indent(level)}</metadata>`,
  ];
}

function formatConcepts(sectionNode: SectionExportNode, level: number): string[] {
  const lines: string[] = [`${indent(level)}<concepts>`];

  for (const concept of sectionNode.concepts) {
    lines.push(`${indent(level + 1)}<concept id="${escapeXml(concept.id)}">`);
    lines.push(tag("name", concept.name, level + 2));
    const explanationLine = optionalTag("explanation", concept.explanation, level + 2);
    if (explanationLine) {
      lines.push(explanationLine);
    }
    lines.push(`${indent(level + 1)}</concept>`);
  }

  lines.push(`${indent(level)}</concepts>`);
  return lines;
}

function formatEquations(sectionNode: SectionExportNode, level: number): string[] {
  const lines: string[] = [`${indent(level)}<equations>`];

  for (const equation of sectionNode.equations) {
    lines.push(`${indent(level + 1)}<equation id="${escapeXml(equation.id)}">`);
    lines.push(tag("name", equation.name, level + 2));
    lines.push(tag("latex", equation.latex, level + 2));
    const descriptionLine = optionalTag("description", equation.description, level + 2);
    if (descriptionLine) {
      lines.push(descriptionLine);
    }
    lines.push(`${indent(level + 1)}</equation>`);
  }

  lines.push(`${indent(level)}</equations>`);
  return lines;
}

function formatVocab(sectionNode: SectionExportNode, level: number): string[] {
  const lines: string[] = [`${indent(level)}<vocab>`];

  for (const vocabTerm of sectionNode.vocabTerms) {
    lines.push(`${indent(level + 1)}<term id="${escapeXml(vocabTerm.id)}">`);
    lines.push(tag("word", vocabTerm.word, level + 2));

    const definitionLine = optionalTag("definition", vocabTerm.definition, level + 2);
    if (definitionLine) {
      lines.push(definitionLine);
    }

    if (vocabTerm.altDefinitions && vocabTerm.altDefinitions.length > 0) {
      lines.push(`${indent(level + 2)}<altDefinitions>`);
      for (const alt of vocabTerm.altDefinitions) {
        lines.push(tag("alt", alt, level + 3));
      }
      lines.push(`${indent(level + 2)}</altDefinitions>`);
    }

    lines.push(`${indent(level + 1)}</term>`);
  }

  lines.push(`${indent(level)}</vocab>`);
  return lines;
}

function formatKeyIdeas(sectionNode: SectionExportNode, level: number): string[] {
  const lines: string[] = [`${indent(level)}<keyIdeas>`];

  for (const keyIdea of sectionNode.keyIdeas) {
    lines.push(`${indent(level + 1)}<keyIdea id="${escapeXml(keyIdea.id)}">`);
    lines.push(tag("text", keyIdea.text, level + 2));
    lines.push(`${indent(level + 1)}</keyIdea>`);
  }

  lines.push(`${indent(level)}</keyIdeas>`);
  return lines;
}

function formatSection(sectionNode: SectionExportNode, level: number): string[] {
  const section = sectionNode.section;
  const lines: string[] = [
    `${indent(level)}<section id="${escapeXml(section.id)}" index="${section.index}">`,
    tag("title", section.title, level + 1),
  ];

  const notesLine = optionalTag("notes", section.notes, level + 1);
  if (notesLine) {
    lines.push(notesLine);
  }

  lines.push(...formatConcepts(sectionNode, level + 1));
  lines.push(...formatEquations(sectionNode, level + 1));
  lines.push(...formatVocab(sectionNode, level + 1));
  lines.push(...formatKeyIdeas(sectionNode, level + 1));
  lines.push(`${indent(level)}</section>`);

  return lines;
}

function formatChapter(chapterNode: ChapterExportNode, level: number): string[] {
  const chapter = chapterNode.chapter;
  const lines: string[] = [
    `${indent(level)}<chapter id="${escapeXml(chapter.id)}" index="${chapter.index}">`,
    tag("name", chapter.name, level + 1),
  ];

  const descriptionLine = optionalTag("description", chapter.description, level + 1);
  if (descriptionLine) {
    lines.push(descriptionLine);
  }

  lines.push(`${indent(level + 1)}<sections>`);
  for (const sectionNode of chapterNode.sections) {
    lines.push(...formatSection(sectionNode, level + 2));
  }
  lines.push(`${indent(level + 1)}</sections>`);
  lines.push(`${indent(level)}</chapter>`);

  return lines;
}

function formatTextbook(data: TextbookExportNode, level: number): string[] {
  const textbook = data.textbook;
  const lines: string[] = [
    `${indent(level)}<textbook id="${escapeXml(textbook.id)}">`,
    tag("title", textbook.title, level + 1),
    tag("grade", textbook.grade, level + 1),
    tag("subject", textbook.subject, level + 1),
    tag("edition", textbook.edition, level + 1),
    tag("publicationYear", String(textbook.publicationYear), level + 1),
  ];

  const platformUrlLine = optionalTag("platformUrl", textbook.platformUrl, level + 1);
  if (platformUrlLine) {
    lines.push(platformUrlLine);
  }

  lines.push(`${indent(level + 1)}<chapters>`);
  for (const chapterNode of data.chapters) {
    lines.push(...formatChapter(chapterNode, level + 2));
  }
  lines.push(`${indent(level + 1)}</chapters>`);
  lines.push(`${indent(level)}</textbook>`);

  return lines;
}

export function formatCurriculumXml(data: TextbookExportNode, metadata: XmlMetadata = {}): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<curriculum>",
    ...formatMetadata(metadata, 1),
    ...formatTextbook(data, 1),
    "</curriculum>",
  ];

  return lines.join("\n");
}
