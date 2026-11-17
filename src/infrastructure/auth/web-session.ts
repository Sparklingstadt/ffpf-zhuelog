import { cookies, headers } from "next/headers";

import { isSecureRequest } from "./secure-request";
import {
  ACT_AS_COOKIE,
  SESSION_COOKIE,
  type CookieWrite,
} from "./session-cookies";

// The session cookies of the current request, through next/headers. Reads
// work anywhere on the server; writeCookies only in Server Actions and Route
// Handlers (Server Components cannot set cookies).

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value || undefined;
}

export async function readActAsCookie(): Promise<string | undefined> {
  return (await cookies()).get(ACT_AS_COOKIE)?.value || undefined;
}

export async function writeCookies(list: CookieWrite[]): Promise<void> {
  const store = await cookies();
  for (const cookie of list)
    store.set(cookie.name, cookie.value, cookie.options);
}

// Whether the cookies written for this request get Secure.
export async function requestIsSecure(): Promise<boolean> {
  return isSecureRequest(await headers());
}
