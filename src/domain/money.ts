export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Cents = Brand<number, "Cents">;

export const MIN_PAYMENT_REQUEST = 30 as Cents;

export type MoneyParseError = {
  code: "empty" | "not_a_number" | "too_many_decimals" | "negative" | "too_large";
  input: string;
};

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function cents(n: number): Cents {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`not cents: ${n}`);
  }
  return n as Cents;
}

export function parseSgd(text: string): Result<Cents, MoneyParseError> {
  const input = text.trim();
  if (!input) return { ok: false, error: { code: "empty", input } };
  if (input.startsWith("-")) return { ok: false, error: { code: "negative", input } };
  const cleaned = input.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false, error: { code: "not_a_number", input } };
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > 2) return { ok: false, error: { code: "too_many_decimals", input } };
  if (whole.length > 14) return { ok: false, error: { code: "too_large", input } };
  const wholeN = parseInt(whole, 10);
  const fracN = parseInt((frac + "00").slice(0, 2), 10);
  const value = wholeN * 100 + fracN;
  if (!Number.isSafeInteger(value)) return { ok: false, error: { code: "too_large", input } };
  return { ok: true, value: value as Cents };
}

export function formatSgd(c: Cents): string {
  const digits = String(c as number).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = digits.slice(-2);
  return `S$${whole}.${frac}`;
}

export function formatAmount(c: Cents): string {
  const digits = String(c as number).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function add(a: Cents, b: Cents): Cents {
  return cents((a as number) + (b as number));
}

export function sub(a: Cents, b: Cents): Cents | null {
  const value = (a as number) - (b as number);
  if (value < 0) return null;
  return cents(value);
}

export function sum(xs: readonly Cents[]): Cents {
  return cents(xs.reduce((total, value) => total + (value as number), 0));
}
