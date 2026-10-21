import { redirect } from "next/navigation";

import { GoApiError, goApi, goUpload, type GoApiInit } from "./client";
import { readAccessToken } from "./go-api-session";

// Go API calls as the signed-in user, for Server Components and Server
// Actions only (they read the zl_access cookie). Without a token, or when Go
// answers 401, the user is sent to /signin. Every other failure is thrown as
// a GoApiError. A call that needs the client IP passes
// clientIp: clientAddress(await headers()).
export function goApiAuthed<T>(
  path: string,
  init: Omit<GoApiInit, "accessToken">,
): Promise<T> {
  return asSignedInUser((accessToken) =>
    goApi<T>(path, { ...init, accessToken }),
  );
}

export function goUploadAuthed<T>(
  path: string,
  form: FormData,
  init: { clientIp?: string } = {},
): Promise<T> {
  return asSignedInUser((accessToken) =>
    goUpload<T>(path, form, { ...init, accessToken }),
  );
}

// For the reads where an admin looks at another person's notes.
export function withUserParam(path: string, ownerId: string | undefined) {
  if (ownerId === undefined) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}user=${encodeURIComponent(ownerId)}`;
}

// redirect() throws NEXT_REDIRECT, so it is never called inside a try block.
async function asSignedInUser<T>(
  call: (accessToken: string) => Promise<T>,
): Promise<T> {
  const accessToken = await readAccessToken();
  if (!accessToken) redirect("/signin");
  try {
    return await call(accessToken);
  } catch (error) {
    if (error instanceof GoApiError && error.status === 401)
      redirect("/signin");
    throw error;
  }
}
