export const voiceover = {
  "provider": "ElevenLabs",
  "voice": "Mike - Animation, Explainers & Gaming",
  "model": "eleven_v4",
  "src": "audio/mike-v4-recut.wav",
  "original": "audio/mike-v4-original.mp3",
  "duration": 139.5,
  "playbackRate": 1,
  "cues": [
    {
      "id": "article-1",
      "chapter": "article",
      "text": "Some Singapore food suppliers have waited up to four months to get paid. That's a real problem.",
      "spokenAt": 0.42,
      "sourceStart": 0.039999999999999994,
      "sourceEnd": 5.6,
      "seconds": 5.56,
      "speechStart": 0.5,
      "speechEnd": 5.8999999999999995
    },
    {
      "id": "policy-1",
      "chapter": "policy",
      "text": "One supplier's answer: no payment, no delivery. But someone still has to figure out who paid what.",
      "spokenAt": 6.62,
      "sourceStart": 5.82,
      "sourceEnd": 11.96,
      "seconds": 6.140000000000001,
      "speechStart": 6.7,
      "speechEnd": 12.680000000000001
    },
    {
      "id": "bridge-1",
      "chapter": "bridge",
      "text": "That's why we built Tally. Let me show you a real workflow, using a fictional customer called Tan BK Café.",
      "spokenAt": 13.32,
      "sourceStart": 12.26,
      "sourceEnd": 18.86,
      "seconds": 6.6,
      "speechStart": 13.4,
      "speechEnd": 19.84
    },
    {
      "id": "import-1",
      "chapter": "import",
      "text": "Here's a bank statement. One eight-hundred-dollar transfer needs to settle two invoices. Tally brings it into a review queue, so we can see where the money should go.",
      "spokenAt": 20.520000000000003,
      "sourceStart": 19.200000000000003,
      "sourceEnd": 27.959999999999997,
      "seconds": 8.759999999999994,
      "speechStart": 20.6,
      "speechEnd": 29.200000000000003
    },
    {
      "id": "allocation-1",
      "chapter": "allocation",
      "text": "Tally suggests five hundred dollars for one invoice, three hundred for the other. It doesn't apply that allocation until I approve it. I review the evidence, approve the split, and now both invoices are settled.",
      "spokenAt": 29.92,
      "sourceStart": 28.26,
      "sourceEnd": 40.1,
      "seconds": 11.84,
      "speechStart": 30,
      "speechEnd": 41.68000000000001
    },
    {
      "id": "debt-1",
      "chapter": "debt",
      "text": "But here's the catch. There's still thirty-eight dollars and forty cents outstanding on Tan BK Café's other invoice. And they've got a new two-hundred-and-twenty-dollar delivery going out tomorrow. Would you release that order?",
      "spokenAt": 42.92,
      "sourceStart": 40.4,
      "sourceEnd": 52.5,
      "seconds": 12.100000000000001,
      "speechStart": 43,
      "speechEnd": 54.940000000000005
    },
    {
      "id": "decision-1",
      "chapter": "decision",
      "text": "Our demo policy flags overdue balances above thirty dollars. Tally recommends pay-first for this delivery. I review the evidence, then approve.",
      "spokenAt": 55.620000000000005,
      "sourceStart": 52.84,
      "sourceEnd": 61.559999999999995,
      "seconds": 8.719999999999992,
      "speechStart": 55.7,
      "speechEnd": 64.26
    },
    {
      "id": "checkout-1",
      "chapter": "checkout",
      "text": "That approval creates a payment request for this new delivery through HitPay's MCP integration. This is HitPay's actual hosted sandbox checkout, for two hundred and twenty dollars.",
      "spokenAt": 64.92,
      "sourceStart": 61.88,
      "sourceEnd": 71.92,
      "seconds": 10.04,
      "speechStart": 65,
      "speechEnd": 74.88
    },
    {
      "id": "simulator-1",
      "chapter": "simulator",
      "text": "I'll use PayNow. The QR opens HitPay's own sandbox simulator. I complete the test payment here, and there it is: payment successful. The money is simulated, but the checkout, payment record and confirmation come directly from HitPay's sandbox.",
      "spokenAt": 76.12,
      "sourceStart": 72.18,
      "sourceEnd": 87.14,
      "seconds": 14.959999999999994,
      "speechStart": 76.2,
      "speechEnd": 90.99999999999999
    },
    {
      "id": "confirm-1",
      "chapter": "confirm",
      "text": "Here's the important part: even though HitPay says successful, the delivery is still held. I click Check payment status. Tally verifies the provider record against this specific request. Only then does it release the order.",
      "spokenAt": 92.62,
      "sourceStart": 87.46000000000001,
      "sourceEnd": 100.84,
      "seconds": 13.379999999999995,
      "speechStart": 92.7,
      "speechEnd": 105.92
    },
    {
      "id": "payoff-1",
      "chapter": "payoff",
      "text": "Now the driver sees Released. But that older invoice? It still has thirty-eight dollars and forty cents outstanding. The customer paid for the new delivery, not the previous debt. Tally keeps them separate.",
      "spokenAt": 107.62,
      "sourceStart": 101.2,
      "sourceEnd": 113.16,
      "seconds": 11.959999999999994,
      "speechStart": 107.7,
      "speechEnd": 119.5
    },
    {
      "id": "audit-1",
      "chapter": "audit",
      "text": "Every approval and release is recorded. We checked the payment twice and restarted Tally: one receipt, the same released delivery, and the old debt still outstanding.",
      "spokenAt": 121.22,
      "sourceStart": 113.44,
      "sourceEnd": 123.46,
      "seconds": 10.019999999999996,
      "speechStart": 121.3,
      "speechEnd": 131.16000000000003
    },
    {
      "id": "close-1",
      "chapter": "close",
      "text": "That's Tally. It connects the money you've actually received to the decision you need to make: can this delivery go out?",
      "spokenAt": 131.92000000000002,
      "sourceStart": 123.84,
      "sourceEnd": 130.44000000000003,
      "seconds": 6.600000000000023,
      "speechStart": 132,
      "speechEnd": 138.44
    }
  ],
  "anchors": [
    {
      "phrase": "approve the split",
      "spokenAt": 38.61999999999999,
      "pictureAt": 38.63333333333333,
      "differenceSeconds": 0.013333333333342523
    },
    {
      "phrase": "approve.",
      "spokenAt": 63.80000000000001,
      "pictureAt": 63.8,
      "differenceSeconds": 1.4210854715202004e-14
    },
    {
      "phrase": "payment successful",
      "spokenAt": 83.72,
      "pictureAt": 83.73333333333333,
      "differenceSeconds": 0.013333333333335418
    },
    {
      "phrase": "Check payment status",
      "spokenAt": 98.79999999999998,
      "pictureAt": 98.8,
      "differenceSeconds": 1.4210854715202004e-14
    }
  ],
  "largestGapBetweenParagraphs": 1.6400000000000006
};
