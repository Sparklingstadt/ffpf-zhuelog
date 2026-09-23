import type { CorrectPersonalText } from "../../application/practice/use-cases/correct-personal-text";
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
  const reader = request.body?.getReader();
  if (!reader) throw new PersonalCorrectionError("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PersonalCorrectionError("tooLarge");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof PersonalCorrectionError) throw error;
    throw new PersonalCorrectionError("invalid");
  } finally {
    reader.releaseLock();
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
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const fetchSite = request.headers.get("sec-fetch-site");
    // Reject browser cross-site calls. No client-selected API host or CORS.
    if (
      !origin ||
      origin !== `${url.protocol}//${host}` ||
      (fetchSite && fetchSite !== "same-origin")
    )
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
