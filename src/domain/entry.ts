import { z } from "zod";
import { parseSgd } from "@/domain/money";
import { asIsoDate } from "@/domain/ids";

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

const date = z
  .string()
  .refine(validCalendarDate, "Enter a valid calendar date.")
  .transform(asIsoDate);
const amount = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const result = parseSgd(value);
    if (!result.ok || result.value === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a positive SGD amount with at most two decimal places.",
      });
      return z.NEVER;
    }
    return result.value;
  });
const customerId = z
  .string()
  .regex(/^CUS-[A-Za-z0-9-]{1,64}$/, "Choose an existing customer.");

export const InvoiceEntry = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^INV-\d{3,6}$/, "Use INV- followed by 3–6 digits."),
    customerId,
    amount,
    issuedOn: date,
    dueOn: date,
  })
  .strict()
  .refine((value) => value.dueOn >= value.issuedOn, {
    path: ["dueOn"],
    message: "Due date cannot precede issue date.",
  });

export const DeliveryEntry = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^DLV-\d{3,9}$/, "Use DLV- followed by 3–9 digits."),
    customerId,
    amount,
    scheduledFor: date,
  })
  .strict();

export type InvoiceEntryValues = z.output<typeof InvoiceEntry>;
export type DeliveryEntryValues = z.output<typeof DeliveryEntry>;
