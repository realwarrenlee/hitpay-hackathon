import { createServer } from "node:http";
import next from "next";
import { installLocalPolicyContext } from "../src/server/local-request-context";

if (process.env.NODE_ENV === "production")
  throw new Error("The local development launcher cannot run in production.");
Object.assign(process.env, { NODE_ENV: "development" });
if (process.argv.includes("--policy-edits"))
  process.env.TALLY_LOCAL_POLICY_EDITS = "on";
const hostname = "127.0.0.1";
const port = 43123;
const context = installLocalPolicyContext();
const app = next({ dev: true, hostname, port });
async function main() {
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    if (
      Object.keys(request.headers).some(
        (key) => key === "forwarded" || key.startsWith("x-forwarded-"),
      )
    ) {
      response
        .writeHead(403)
        .end("Forwarded requests are not supported in local development mode");
      return;
    }
    if (![`${hostname}:${port}`, `localhost:${port}`].includes(host)) {
      response.writeHead(403).end("Loopback host required");
      return;
    }
    context.run(
      {
        localAddress: request.socket.localAddress ?? "",
        remoteAddress: request.socket.remoteAddress ?? "",
        host,
        origin: request.headers.origin ?? null,
        method: request.method ?? "",
        port,
      },
      () => {
        void handle(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end("Unable to complete request");
        });
      },
    );
  });
  server.on("upgrade", app.getUpgradeHandler());
  server.listen(port, hostname, () =>
    console.log(
      `Tally local development: http://${hostname}:${port}${process.env.TALLY_LOCAL_POLICY_EDITS === "on" ? " (local policy editing enabled)" : " (policy editing disabled)"}`,
    ),
  );
}
void main();
