"use server";
import { revalidatePath } from "next/cache";
import {
  currentPolicy,
  savePolicy,
  type PolicySaveResult,
  type PolicyView,
} from "@/server/policy";
export async function savePolicyAction(
  input: unknown,
): Promise<PolicySaveResult> {
  const result = savePolicy(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
export async function reloadPolicyAction(): Promise<PolicyView> {
  return currentPolicy();
}
