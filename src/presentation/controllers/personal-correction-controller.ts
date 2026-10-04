import type { CorrectPersonalText } from "@ffpf-zhuelog/core/application/practice/use-cases/correct-personal-text";
import {
  readLimitedBody,
  BodyLimitError,
} from "../../infrastructure/http/read-limited-body";
import { isSameOriginRequest } from "../http/same-origin";
import { PersonalCorrectionError } from "@ffpf-zhuelog/core/domain/practice/personal-correction";
import {
  correctionErrors,
  type CorrectionErrorCode,
} from "../presenters/personal-correction-errors";

const statuses: Record<CorrectionErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  origin: 403,
  tooLarge: 413,
  key: 422,
  limited: 429,
  timeout: 504,
  unavailable: 502,
};
// Rejections of the HTTP request itself, before any correction starts.
class RequestRejected extends Error {
  constructor(public readonly code: CorrectionErrorCode) {
    super(code);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readInput(request: Request) {
  const maxBytes = 8192;
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new RequestRejected("tooLarge");
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new RequestRejected("invalid");
  try {
    return JSON.parse(
      (await readLimitedBody(request, maxBytes)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof BodyLimitError) throw new RequestRejected("tooLarge");
    throw new RequestRejected("invalid");
  }
}

export async function handlePersonalCorrection(
  request: Request,
  dependencies: {
    isAuthenticated: () => Promise<boolean>;
    correctText: Pick<CorrectPersonalText, "execute">;
  },
) {
  try {
    if (!(await dependencies.isAuthenticated()))
      throw new RequestRejected("unauthorized");
    // Reject browser cross-site calls. No client-selected API host or CORS.
    if (!isSameOriginRequest(request)) throw new RequestRejected("origin");
    const input = await readInput(request);
    return json(await dependencies.correctText.execute(input, request.signal));
  } catch (error) {
    // Never return/log provider errors, request bodies, or credentials.
    const code =
      error instanceof PersonalCorrectionError ||
      error instanceof RequestRejected
        ? error.code
        : "unavailable";
    return json({ code, error: correctionErrors[code] }, statuses[code]);
  }
}
