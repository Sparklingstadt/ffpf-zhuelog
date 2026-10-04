import { z } from "zod";
import { readLimitedBody } from "../http/read-limited-body";

export class OpenAiRefusalError extends Error {
  constructor() {
    super("OPENAI_REFUSAL");
  }
}

const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
    }),
  ),
});

// Reads a Responses API body (capped at 128 KiB) and returns the concatenated
// output text of its messages.
export async function readOutputText(response: Response) {
  const payload = responseSchema.parse(
    JSON.parse((await readLimitedBody(response, 128 * 1024)).toString("utf8")),
  );
  const contents = payload.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? []);
  if (contents.some((item) => item.type === "refusal"))
    throw new OpenAiRefusalError();
  return contents
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("");
}
