export const ALLOWED_TOOLS = ["create_invoice", "list_invoices", "create_customer", "create_payment_request", "get_payment_request", "list_charges", "get_charge_detail"] as const;

export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export function isAllowedTool(name: string): name is AllowedTool {
  return (ALLOWED_TOOLS as readonly string[]).includes(name);
}
