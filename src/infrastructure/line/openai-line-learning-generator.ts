import { z } from "zod";
import type { LineLearningGenerator } from "@ffpf-zhuelog/core/application/line/ports/line-learning-generator";
import {
  correctionSchema,
  CORRECTION_INSTRUCTIONS,
} from "@ffpf-zhuelog/core/domain/learning/chinese-correction";
import {
  translationSchema,
  TRANSLATION_INSTRUCTIONS,
} from "@ffpf-zhuelog/core/domain/learning/chinese-translation";
import {
  LineGenerationError,
  type GenerationFailureCode,
} from "@ffpf-zhuelog/core/domain/line/generation-failure";
import { endpointOverride } from "../config/test-endpoint";
import { readOutputText } from "../openai/responses";

// Fixed on the server; clients never choose the model.
const MODEL = "gpt-5-mini";

// Never log the text, the result or the key here: they are personal data and
// a credential. Errors carry only a failure code.
export class OpenAiLineLearningGenerator implements LineLearningGenerator {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = endpointOverride(
      process.env.OPENAI_API_BASE_URL,
      "https://api.openai.com",
    ),
    private readonly timeoutMs = 20_000,
  ) {}

  correct(text: string, signal: AbortSignal) {
    return this.generate(
      text,
      signal,
      CORRECTION_INSTRUCTIONS,
      "chinese_correction",
      correctionSchema,
    );
  }

  translate(text: string, signal: AbortSignal) {
    return this.generate(
      text,
      signal,
      TRANSLATION_INSTRUCTIONS,
      "japanese_to_chinese_translation",
      translationSchema,
    );
  }

  private async generate<T extends z.ZodType>(
    text: string,
    signal: AbortSignal,
    instructions: string,
    name: string,
    schema: T,
  ): Promise<z.infer<T>> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    // A deadline from either our timer or the caller is a timeout.
    const failure = (code: GenerationFailureCode) =>
      new LineGenerationError(
        timeout.aborted || signal.aborted ? "OPENAI_TIMEOUT" : code,
      );
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/v1/responses`, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([signal, timeout]),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          instructions,
          input: text,
          store: false,
          max_output_tokens: 4000,
          reasoning: { effort: "minimal" },
          text: {
            format: {
              type: "json_schema",
              name,
              strict: true,
              schema: z.toJSONSchema(schema, { target: "draft-7" }),
            },
          },
        }),
      });
    } catch {
      throw failure("OPENAI_REQUEST_FAILED");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw failure(
        response.status === 401 || response.status === 403
          ? "OPENAI_AUTH_FAILED"
          : response.status === 429
            ? "OPENAI_RATE_LIMITED"
            : "OPENAI_REQUEST_FAILED",
      );
    }
    try {
      return schema.parse(JSON.parse(await readOutputText(response)));
    } catch {
      throw failure("OPENAI_INVALID_RESPONSE");
    }
  }
}
