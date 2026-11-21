# Tally demo video

The finished composition is 2:19.5, at 1920 × 1080 and 30 fps. It uses Mike — Animation, Explainers & Gaming with ElevenLabs v4, Seven Miles by West & Zander, and the verified sandbox recordings.

Run these commands from this folder:

```powershell
npm run studio -- --no-open
npm run check
npm run render
```

The preview is [TallyStoryboard](http://localhost:43125/TallyStoryboard). Rendering creates [DEMO.mp4](../DEMO.mp4) in the project root. Use `npm ci` to restore dependencies if needed.

## Files to keep

- `src/`: Remotion composition and entry point.
- `scenes.mjs` and `edit.mjs`: chapter timings, narration and source footage edits.
- `voiceover.mjs` and `music.mjs`: current audio timing and provenance.
- `public/`: only the assets referenced by the finished composition, storyboard and checks, plus the original Mike recording.
- `audio/`: the selected Mike generation metadata and word alignment.
- [script.txt](script.txt) and [voiceover-cues.txt](voiceover-cues.txt): current script and spoken timings.
- [storyboard.html](storyboard.html): scene references and source recordings. Rebuild with `node build-board.mjs`.
- `check.mjs`: asset, timing, source-order, narration and audio peak checks.

The music is a public preview recording; publication licensing has not been verified.

## Evidence and archive

The [sandbox verification report](../artifacts/demo-continuous-20261120-2216/report.html) and the [Mike playback checks](../artifacts/demo-mike-v4-20261121/preview-proof.json) remain outside this folder.

Superseded captures, exports, comparison audio and one-off scripts are preserved in [the dated archive](../artifacts/demo-archive-20261121/). The [cleanup manifest](../artifacts/demo-cleanup-20261121/plan.json) maps their original paths to the archive; [results](../artifacts/demo-cleanup-20261121/result.json) record the content-hash and ledger checks. Archived scripts are historical and are not part of the current build.
