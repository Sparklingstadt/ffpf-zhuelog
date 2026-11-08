import { cookies, headers } from "next/headers";

import { parseHskBasis, type HskBasis } from "@/domain/practice/hsk-level";
import { isSecureRequest } from "@/infrastructure/go-api/go-api-session";

// How the practices decide HSK levels, chosen by the learner and kept in a
// cookie (the server builds the quiz, so it has to know). Not personal data.
export const HSK_BASIS_COOKIE = "zhuelog_hsk_basis";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function readHskBasis(): Promise<HskBasis> {
  return parseHskBasis((await cookies()).get(HSK_BASIS_COOKIE)?.value);
}

export async function writeHskBasis(basis: HskBasis): Promise<void> {
  (await cookies()).set(HSK_BASIS_COOKIE, basis, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureRequest(await headers()),
    maxAge: ONE_YEAR,
  });
}
