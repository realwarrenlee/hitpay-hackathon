import { AsyncLocalStorage } from "node:async_hooks";
export interface LocalPolicyRequest {
  localAddress: string;
  remoteAddress: string;
  host: string;
  origin: string | null;
  method: string;
  port: number;
}
const shared = globalThis as typeof globalThis & {
  __tallyLocalPolicyContext?: AsyncLocalStorage<LocalPolicyRequest>;
};
export function installLocalPolicyContext() {
  shared.__tallyLocalPolicyContext =
    new AsyncLocalStorage<LocalPolicyRequest>();
  return shared.__tallyLocalPolicyContext;
}
export function localPolicyRequest() {
  return shared.__tallyLocalPolicyContext?.getStore();
}
