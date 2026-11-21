"use server";
import { revalidatePath } from "next/cache";
import { saveEntry, type EntryResult } from "@/server/entries";

export async function saveEntryAction(
  kind: "invoice" | "delivery",
  input: unknown,
): Promise<EntryResult> {
  const result = saveEntry(kind, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
