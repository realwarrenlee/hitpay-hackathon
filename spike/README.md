# Signature spike

Standalone, dependency-free signature/tamper/replay exercise retained as a local verification aid:

```sh
node spike/tamper-test.mjs
```

Exit code zero means its good signature, tamper and replay examples pass. It is not a real HitPay callback or payment test. Current application verification and limitations are in [docs/verification.md](../docs/verification.md); the runtime implementation is [webhook.ts](../src/server/hitpay/webhook.ts).
