import { z } from "zod";
import type { PersonalCorrectionGateway } from "@ffpf-zhuelog/core/application/practice/ports/personal-correction-gateway";
import {
  correctionSchema,
  CORRECTION_INSTRUCTIONS,
} from "@ffpf-zhuelog/core/domain/learning/chinese-correction";
import { PersonalCorrectionError } from "@ffpf-zhuelog/core/domain/practice/personal-correction";
import { PersonalRequestLimiter } from "./personal-request-limiter";
import { readOutputText } from "../openai/responses";

// Fixed on the server; clients never choose the model.
const PERSONAL_CORRECTION_MODEL = "gpt-5-mini";

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
      const text = await readOutputText(response);
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
