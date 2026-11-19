import { z } from "zod";

export const HintsSchema = z
  .object({
    alias: z.string().trim().min(1).max(40).nullable(),
    invoiceTokens: z.array(z.string().regex(/^INV-\d{3,6}$/)).max(4),
  })
  .strict();

export type Hints = z.infer<typeof HintsSchema>;
