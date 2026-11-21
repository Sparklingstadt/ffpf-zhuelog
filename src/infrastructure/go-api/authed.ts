import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { confirmedActAs } from "./act-as";
import { GoApiError, goApi, type GoApiInit } from "./client";
import { CURRENT_PATH_HEADER, signInPathFor } from "./current-path";
import { readAccessToken } from "./go-api-session";

// How a gateway reaches Go: goApiAuthed in the app, a fake in tests.
export type GoApiCall = <T>(
  path: string,
  init: Omit<GoApiInit, "accessToken">,
) => Promise<T>;

// Go API calls as the signed-in user, for Server Components and Server
// Actions only (they read the zl_access cookie). While an admin acts as a
// member (confirmedActAs), the calls carry X-Zhuelog-Act-As. Without a token, or when Go
// answers 401, the user is sent to /signin with a callbackUrl back to the
// current page (the path the proxy recorded). Every other failure is thrown as
// a GoApiError. A call that needs the client IP passes
// clientIp: clientAddress(await headers()).
export function goApiAuthed<T>(
  path: string,
  init: Omit<GoApiInit, "accessToken" | "actAs">,
): Promise<T> {
  return asSignedInUser((accessToken, actAs) =>
    goApi<T>(path, { ...init, accessToken, actAs }),
  );
}

// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.
async function asSignedInUser<T>(
  call: (accessToken: string, actAs: string | undefined) => Promise<T>,
): Promise<T> {
  const accessToken = await readAccessToken();
  if (!accessToken) redirect(await currentSignInPath());
  const actAs = await confirmedActAs();
  try {
    return await call(accessToken, actAs);
  } catch (error) {
    if (error instanceof GoApiError && error.status === 401)
      redirect(await currentSignInPath());
    throw error;
  }
}

async function currentSignInPath() {
  return signInPathFor((await headers()).get(CURRENT_PATH_HEADER));
}
