import { cache } from "react";

import { fetchMe } from "./client";
import { readAccessToken, readActAsCookie } from "./go-api-session";

// GET /v1/me at most once per request for each (token, member) pair: the
// current user and confirmedActAs ask the same question.
export const fetchMeOnce = cache((token: string, actAs?: string) =>
  fetchMe(token, actAs),
);

// The member whose records this request reads and writes, when an admin acts
// as one. The act-as cookie alone is not enough: an older Go API ignores the
// header, so it is sent only once GET /v1/me has confirmed it. Any failure
// means "not acting", and the call itself then reports the real problem.
export const confirmedActAs = cache(async (): Promise<string | undefined> => {
  const actAs = await readActAsCookie();
  const token = await readAccessToken();
  if (!actAs || !token) return undefined;
  try {
    const me = await fetchMeOnce(token, actAs);
    return me.role === "admin" && me.actingAs?.ownerId === actAs
      ? actAs
      : undefined;
  } catch {
    return undefined;
  }
});
