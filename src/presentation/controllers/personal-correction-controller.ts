import type { CorrectPersonalText } from "../../application/practice/use-cases/correct-personal-text";
import {
  readLimitedBody,
  BodyLimitError,
} from "../../infrastructure/http/read-limited-body";
import { isSameOriginRequest } from "../http/same-origin";
import {
  correctionErrors,
  PersonalCorrectionError,
  type CorrectionErrorCode,
} from "../../domain/practice/personal-correction";

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
    throw new PersonalCorrectionError("tooLarge");
  if (
    request.headers.get("content-type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new PersonalCorrectionError("invalid");
  try {
    return JSON.parse(
      (await readLimitedBody(request, maxBytes)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof BodyLimitError)
      throw new PersonalCorrectionError("tooLarge");
    throw new PersonalCorrectionError("invalid");
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
      throw new PersonalCorrectionError("unauthorized");
    // Reject browser cross-site calls. No client-selected API host or CORS.
    if (!isSameOriginRequest(request))
      throw new PersonalCorrectionError("origin");
    const input = await readInput(request);
    return json(await dependencies.correctText.execute(input, request.signal));
  } catch (error) {
    // Never return/log provider errors, request bodies, or credentials.
    const code =
      error instanceof PersonalCorrectionError ? error.code : "unavailable";
    return json({ code, error: correctionErrors[code] }, statuses[code]);
  }
}
