import { readEnv } from "../src/server/env";
import { signBody } from "../src/server/hitpay/webhook";

const env = readEnv();
if (env.gateway === "mcp") {
  console.error("send-webhook refuses TALLY_GATEWAY=mcp");
  process.exit(1);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const reference = flag("--reference");
const amount = flag("--amount");
if (!reference || !amount) {
  console.error("usage: send-webhook --reference <ref> --amount <sgd> [--tamper] [--replay]");
  process.exit(1);
}

const body = JSON.stringify({
  event_type: "payment_request.completed",
  payment_request_id: `hitpay_script_${reference}`,
  reference_number: reference,
  amount,
  status: "completed",
});
const raw = new TextEncoder().encode(body);
const signature = signBody(raw, env.webhookSalt);
const tampered = process.argv.includes("--tamper") ? new TextEncoder().encode(body.replace(amount, `${amount}9`)) : raw;
const url = `${env.appUrl}/api/hitpay/webhook`;

async function post(bytes: Uint8Array) {
  const response = await fetch(url, { method: "POST", headers: { "hitpay-signature": signature, "content-type": "application/json" }, body: Buffer.from(bytes) });
  console.log(response.status, await response.text());
  return response.status;
}

const status = await post(tampered);
if (process.argv.includes("--replay")) await post(tampered);
process.exit(status === 200 || (process.argv.includes("--tamper") && status === 401) ? 0 : 1);
