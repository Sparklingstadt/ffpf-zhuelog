import { z } from "zod";
import type { PersonalCorrectionGateway } from "../../application/practice/ports/personal-correction-gateway";
import {
  correctionSchema,
  CORRECTION_INSTRUCTIONS,
} from "../../domain/learning/chinese-correction";
import {
  PERSONAL_CORRECTION_MODEL,
  PersonalCorrectionError,
} from "../../domain/practice/personal-correction";
import { PersonalRequestLimiter } from "./personal-request-limiter";
import { readLimitedBody } from "../http/read-limited-body";

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

export class OpenAiPersonalCorrectionGateway implements PersonalCorrectionGateway {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly limiter = new PersonalRequestLimiter(),
    private readonly timeoutMs = 45_000,
  ) {}

  async correct(originalText: string, apiKey: string, signal: AbortSignal) {
    const release = this.limiter.acquire(apiKey);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      // Deliberately no shared SDK/provider, environment key, retries or DB.
      const response = await this.fetcher(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([signal, timeout]),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: PERSONAL_CORRECTION_MODEL,
            instructions: CORRECTION_INSTRUCTIONS,
            input: originalText,
            store: false,
            max_output_tokens: 4000,
            reasoning: { effort: "minimal" },
            text: {
              format: {
                type: "json_schema",
                name: "chinese_correction",
                strict: true,
                schema: z.toJSONSchema(correctionSchema, { target: "draft-7" }),
              },
            },
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new PersonalCorrectionError(
          response.status === 401 || response.status === 403
            ? "key"
            : response.status === 429
              ? "limited"
              : "unavailable",
        );
      }
      const payload = responseSchema.parse(
        JSON.parse(
          (await readLimitedBody(response, 128 * 1024)).toString("utf8"),
        ),
      );
      const contents = payload.output
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? []);
      if (contents.some((item) => item.type === "refusal"))
        throw new PersonalCorrectionError("unavailable");
      const text = contents
        .filter((item) => item.type === "output_text")
        .map((item) => item.text ?? "")
        .join("");
      const correction = correctionSchema.parse(JSON.parse(text));
      // Also reject a provider unexpectedly returning the credential verbatim.
      if (JSON.stringify(correction).includes(apiKey))
        throw new PersonalCorrectionError("unavailable");
      return correction;
    } catch (error) {
      if (error instanceof PersonalCorrectionError) throw error;
      throw new PersonalCorrectionError(
        timeout.aborted || signal.aborted ? "timeout" : "unavailable",
      );
    } finally {
      release();
    }
  }
}
