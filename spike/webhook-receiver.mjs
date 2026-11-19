import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of the raw JSON body, hex. Matches HitPay's Hitpay-Signature header. */
export function signHitpayBody(raw, salt) {
  return createHmac("sha256", salt).update(raw).digest("hex");
}

export function verifyHitpaySignature(raw, signature, salt) {
  if (!signature || !salt) return false;
  const computed = signHitpayBody(raw, salt);
  const left = Buffer.from(computed);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function bodyHash(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

export function remember(seen, raw) {
  const hash = bodyHash(raw);
  if (seen.has(hash)) return "replay";
  seen.add(hash);
  return "fresh";
}
