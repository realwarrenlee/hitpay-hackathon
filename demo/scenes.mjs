export const articleUrl = "https://www.channelnewsasia.com/singapore/fb-food-suppliers-revenue-delayed-payments-5349901";
export const fps = 30;
export const scenes = [
  {
    "id": "article",
    "seconds": 6.2,
    "title": "A real supplier problem",
    "kind": "article",
    "narration": "Some Singapore food suppliers have waited up to four months to get paid. That's a real problem.",
    "motion": "Use the supplied Screenshot (45): original CNA page, cropped to 16:9 over the grass. Keep the complete headline, CNA branding and author/date visible; crop away the scrollbar and excess bottom image.",
    "assets": [
      "cna/user-headline.png"
    ],
    "status": "User-supplied Screenshot (45), unchanged source pixels. Cropped non-destructively inside a 16:9 frame; original preserved.",
    "sourceWidth": 2880,
    "sourceHeight": 1800,
    "cropWidth": 2850,
    "start": 0,
    "end": 6.2
  },
  {
    "id": "policy",
    "seconds": 6.7,
    "title": "No payment, no delivery",
    "kind": "article",
    "narration": "One supplier's answer: no payment, no delivery. But someone still has to figure out who paid what.",
    "motion": "Hold the supplied Screenshot (46) at a fixed 16:9 crop, with no zoom. Preserve its existing blue-selected policy sentence, then transition into Tally over the same grass.",
    "assets": [
      "cna/user-policy.png"
    ],
    "status": "User-supplied Screenshot (46), with its real blue text selection preserved. A 2488×1399.5 source viewport gives an exact 16:9 crop without the scrollbar or lower photograph.",
    "sourceWidth": 2880,
    "sourceHeight": 1800,
    "cropWidth": 2488,
    "start": 6.2,
    "end": 12.9
  },
  {
    "id": "bridge",
    "seconds": 7.2,
    "title": "Meet Tally",
    "kind": "screen",
    "narration": "That's why we built Tally. Let me show you a real workflow, using a fictional customer called Tan BK Café.",
    "motion": "Continuous overview → Bank credits → Import. This recording continues through import and allocation approval, without a carousel cut inside the workflow.",
    "assets": [
      "clean/continuous/overview.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 12.9,
    "end": 20.1,
    "clip": "clean/continuous/01-reconciliation.webm",
    "clipIn": 2.439,
    "clipSeconds": 7.2
  },
  {
    "id": "import",
    "seconds": 9.4,
    "title": "Review incoming payments",
    "kind": "screen",
    "narration": "Here's a bank statement. One eight-hundred-dollar transfer needs to settle two invoices. Tally brings it into a review queue, so we can see where the money should go.",
    "motion": "Actual file selection, import click and new credits, followed by navigation to Review in the same recording.",
    "assets": [
      "clean/continuous/import-completed.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 20.1,
    "end": 29.5,
    "clip": "clean/continuous/01-reconciliation.webm",
    "clipIn": 10.804767441860465,
    "clipSeconds": 9.4
  },
  {
    "id": "allocation",
    "seconds": 13,
    "title": "Review and approve the split",
    "kind": "screen",
    "narration": "Tally suggests five hundred dollars for one invoice, three hundred for the other. It doesn't apply that allocation until I approve it. I review the evidence, approve the split, and now both invoices are settled.",
    "motion": "The same recording continues: open the split, read both allocations, approve through the real native confirmation, then navigate to the customer’s two zero-balance invoices.",
    "assets": [
      "clean/continuous/paid-invoices.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 29.5,
    "end": 42.5,
    "clip": "clean/continuous/01-reconciliation.webm",
    "clipIn": 24.115749152542374,
    "clipSeconds": 13
  },
  {
    "id": "debt",
    "seconds": 12.7,
    "title": "S$38.40 overdue · S$220 delivery",
    "kind": "screen",
    "narration": "But here's the catch. There's still thirty-eight dollars and forty cents outstanding on Tan BK Café's other invoice. And they've got a new two-hundred-and-twenty-dollar delivery going out tomorrow. Would you release that order?",
    "motion": "Read the actual delivery detail and scroll through the overdue invoice evidence. The live recording continues into Evaluate delivery and approval.",
    "assets": [
      "clean/continuous/before-evaluation.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 42.5,
    "end": 55.2,
    "clip": "clean/continuous/03-decision.webm",
    "clipIn": 5.178,
    "clipSeconds": 12.7
  },
  {
    "id": "decision",
    "seconds": 9.3,
    "title": "Review the delivery decision",
    "kind": "screen",
    "narration": "Our demo policy flags overdue balances above thirty dollars. Tally recommends pay-first for this delivery. I review the evidence, then approve.",
    "motion": "Real Evaluate delivery → recommendation → human pay-first approval → pending S$220 request, in one take.",
    "assets": [
      "clean/continuous/held.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 55.2,
    "end": 64.5,
    "clip": "clean/continuous/03-decision.webm",
    "clipIn": 21.222079831932774,
    "clipSeconds": 9.3
  },
  {
    "id": "checkout",
    "seconds": 11.2,
    "title": "HitPay sandbox checkout",
    "kind": "screen",
    "sandbox": true,
    "narration": "That approval creates a payment request for this new delivery through HitPay's MCP integration. This is HitPay's actual hosted sandbox checkout, for two hundred and twenty dollars.",
    "motion": "Continuous hosted checkout, fictional email entry and provider-generated QR. The same take opens the decoded sandbox simulator and completes payment.",
    "assets": [
      "clean/continuous/qr.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/. The provider console-clean check failed on one WebSocket closure message; it is retained, not suppressed. Real HitPay sandbox; simulated funds. Remote completion was independently retrieved through the app’s MCP gateway.",
    "start": 64.5,
    "end": 75.7,
    "clip": "clean/continuous/04-payment.webm",
    "clipIn": 3.943,
    "clipSeconds": 11.2,
    "completionAt": 21.1
  },
  {
    "id": "simulator",
    "seconds": 16.5,
    "title": "Complete the test payment",
    "kind": "screen",
    "sandbox": true,
    "narration": "I'll use PayNow. The QR opens HitPay's own sandbox simulator. I complete the test payment here, and there it is: payment successful. The money is simulated, but the checkout, payment record and confirmation come directly from HitPay's sandbox.",
    "motion": "The payment recording continues through the real simulator button and success, then returns to HitPay’s actual completed checkout. Loading stays visible only where it helps continuity.",
    "assets": [
      "clean/continuous/checkout-completed.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/. Real HitPay sandbox; simulated funds. Remote completion was independently retrieved through the app’s MCP gateway.",
    "start": 75.7,
    "end": 92.2,
    "clip": "clean/continuous/04-payment.webm",
    "clipIn": 15.620925925925926,
    "clipSeconds": 16.5
  },
  {
    "id": "confirm",
    "seconds": 15,
    "title": "Verify payment, then release",
    "kind": "screen",
    "narration": "Here's the important part: even though HitPay says successful, the delivery is still held. I click Check payment status. Tally verifies the provider record against this specific request. Only then does it release the order.",
    "motion": "Hold on the still-held delivery, show the actual status-check click and changed Released state, then follow the driver link. This is the main reveal, not before-and-after screenshots.",
    "assets": [
      "clean/continuous/released.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 92.2,
    "end": 107.2,
    "clip": "clean/continuous/05-release.webm",
    "clipIn": 1.474,
    "clipSeconds": 15
  },
  {
    "id": "payoff",
    "seconds": 13.6,
    "title": "Delivery released · Old invoice still due",
    "kind": "screen",
    "narration": "Now the driver sees Released. But that older invoice? It still has thirty-eight dollars and forty cents outstanding. The customer paid for the new delivery, not the previous debt. Tally keeps them separate.",
    "motion": "Continue the release take into the driver view and the old invoice. A separately recorded live mobile driver view appears beside the actual old-debt page; no screenshot freeze fills the chapter.",
    "assets": [
      "clean/continuous/debt.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 107.2,
    "end": 120.8,
    "clip": "clean/continuous/05-release.webm",
    "clipIn": 20.11128,
    "clipSeconds": 13.6,
    "driverClip": "clean/continuous/06-driver.webm",
    "driverClipIn": 1.904,
    "driverClipSeconds": 14.4
  },
  {
    "id": "audit",
    "seconds": 10.7,
    "title": "Approval and release history",
    "kind": "screen",
    "narration": "Every approval and release is recorded. We checked the payment twice and restarted Tally: one receipt, the same released delivery, and the old debt still outstanding.",
    "motion": "Type the delivery reference, read its events, clear the filter and scroll through the real history. End after 12 seconds.",
    "assets": [
      "clean/continuous/audit.png"
    ],
    "status": "New continuous capture from DLV-9401 / INV-9401 on a fresh disposable ledger. Actual UI actions and outcomes; The current cut retimes the recorded navigation around the narration; actions remain chronological. Original recordings and verification are retained in artifacts/demo-continuous-20261120-2216/.",
    "start": 120.8,
    "end": 131.5,
    "clip": "clean/continuous/07-audit.webm",
    "clipIn": 2.61,
    "clipSeconds": 10.7
  },
  {
    "id": "close",
    "seconds": 8,
    "title": "Can this delivery go out?",
    "kind": "close",
    "narration": "That's Tally. It connects the money you've actually received to the decision you need to make: can this delivery go out?",
    "motion": "Finish on Tally and the single question “Can this delivery go out?” over the existing grass background. No extra tagline.",
    "assets": [],
    "status": "Remotion closing design. LottieFiles remains optional; no Lottie asset is connected.",
    "start": 131.5,
    "end": 139.5
  }
];
export const duration = 139.5;
