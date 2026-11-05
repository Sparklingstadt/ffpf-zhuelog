export type QuestionSummary = {
  id: string;
  question: string;
  modelName: string;
  createdAt: Date;
};
export type QuestionNote = QuestionSummary & { answer: string };
export type SaveQuestionInput = {
  id: string;
  question: string;
  answer: string;
};
export const MAX_QUESTION_CHARS = 4000;
