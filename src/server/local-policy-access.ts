import { readLocalPolicyMode } from "@/server/env";
import {
  localPolicyRequest,
  type LocalPolicyRequest,
} from "@/server/local-request-context";
export function trustedLoopbackRequest(
  request: LocalPolicyRequest | undefined,
  write: boolean,
): boolean {
  if (!request) return false;
  const loopback = (value: string) =>
    value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
  if (!loopback(request.localAddress) || !loopback(request.remoteAddress))
    return false;
  if (
    ![`127.0.0.1:${request.port}`, `localhost:${request.port}`].includes(
      request.host,
    )
  )
    return false;
  if (
    write &&
    (request.method !== "POST" || request.origin !== `http://${request.host}`)
  )
    return false;
  return true;
}
export function localPolicyAccess(write = false): boolean {
  return (
    readLocalPolicyMode() && trustedLoopbackRequest(localPolicyRequest(), write)
  );
}
