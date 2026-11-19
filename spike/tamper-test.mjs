import { remember, signHitpayBody, verifyHitpaySignature } from "./webhook-receiver.mjs";

const salt = "tally-demo-salt";
const raw = JSON.stringify({
  id: "hp_demo",
  status: "completed",
  amount: "150.00",
  currency: "SGD",
  reference_number: "payfirst:INV-2410",
});
const signature = signHitpayBody(raw, salt);

const failures = [];

if (!verifyHitpaySignature(raw, signature, salt)) {
  failures.push("a good signature was rejected");
}

const tampered = raw.replace("150.00", "150.01");
if (verifyHitpaySignature(tampered, signature, salt)) {
  failures.push("a tampered body was accepted");
}

if (verifyHitpaySignature(raw, `${signature.slice(0, -1)}0`, salt)) {
  failures.push("a flipped signature was accepted");
}

const seen = new Set();
if (remember(seen, raw) !== "fresh") failures.push("first sight was not fresh");
if (remember(seen, raw) !== "replay") failures.push("second sight was not a replay");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("spike ok: signature, tamper, replay");
