export type McQuestion = {
  id: number;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  answer: "A" | "B" | "C" | "D";
};

export type FaQuestion = {
  id: number;
  question: string;
};

export type QuizData = {
  mc: McQuestion[];
  fa: FaQuestion[];
};

export type SourceFile = {
  name: string;
  content: string;
};

export type McScored = {
  id: number;
  question: string;
  options: McQuestion["options"];
  correct: McQuestion["answer"];
  chosen: McQuestion["answer"];
  score: 0 | 1;
};

export type FaScored = {
  id: number;
  score: number;
  feedback: string;
};

export type FaAnswer = {
  id: number;
  question: string;
  answer: string;
};
