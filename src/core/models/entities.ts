export interface Textbook {
  id: string;
  title: string;
  grade: string;
  subject: string;
  edition: string;
  publicationYear: number;
  platformUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  textbookId: string;
  index: number;
  name: string;
  description?: string;
}

export interface Section {
  id: string;
  chapterId: string;
  index: number;
  title: string;
  notes?: string;
}

export interface VocabTerm {
  id: string;
  sectionId: string;
  word: string;
  definition?: string;
  altDefinitions?: string[];
}

export interface Equation {
  id: string;
  sectionId: string;
  name: string;
  latex: string;
  description?: string;
}

export interface Concept {
  id: string;
  sectionId: string;
  name: string;
  explanation?: string;
}

export interface KeyIdea {
  id: string;
  sectionId: string;
  text: string;
}

export interface CourseForgeEntityMap {
  textbooks: Textbook;
  chapters: Chapter;
  sections: Section;
  vocabTerms: VocabTerm;
  equations: Equation;
  concepts: Concept;
  keyIdeas: KeyIdea;
}
