import { revalidatePath } from "next/cache";

// Every list, the home page's recent notes and the trash pages change.
export function revalidateNotes() {
  revalidatePath("/");
  revalidatePath("/logs", "layout");
}
