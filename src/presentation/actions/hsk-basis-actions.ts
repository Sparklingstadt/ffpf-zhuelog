"use server";

import { redirect } from "next/navigation";

import { parseHskBasis } from "@/domain/practice/hsk-level";
import { writeHskBasis } from "@/infrastructure/preferences/hsk-basis-cookie";

// Only the practice pages offer the switch, so only they are returned to.
const RETURN_PATH = /^\/practice\/[a-z-]+(\/[a-z-]+)?(\?hsk=[456])?$/;

// Saves how HSK levels are decided and reloads the practice page, which
// rebuilds its quiz and counts the new way.
export async function setHskBasisAction(formData: FormData): Promise<void> {
  await writeHskBasis(parseHskBasis(formData.get("basis")));
  const back = formData.get("returnTo");
  redirect(
    typeof back === "string" && RETURN_PATH.test(back) ? back : "/practice",
  );
}
