import { CorrectPersonalText } from "../application/practice/use-cases/correct-personal-text";
import { OpenAiPersonalCorrectionGateway } from "../infrastructure/practice/openai-personal-correction-gateway";

export const correctPersonalText = new CorrectPersonalText(
  new OpenAiPersonalCorrectionGateway(),
);
