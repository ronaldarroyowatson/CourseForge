import type { Chapter, Concept, Equation, KeyIdea, Section, Textbook, VocabTerm } from "../../models";

export interface SectionExportNode {
  section: Section;
  concepts: Concept[];
  equations: Equation[];
  vocabTerms: VocabTerm[];
  keyIdeas: KeyIdea[];
}

export interface ChapterExportNode {
  chapter: Chapter;
  sections: SectionExportNode[];
}

export interface TextbookExportNode {
  textbook: Textbook;
  chapters: ChapterExportNode[];
}

export interface XmlMetadata {
  generatedBy?: string;
  generatedAt?: string;
  version?: string;
}
