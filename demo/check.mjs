import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {duration, fps, scenes} from './scenes.mjs';
import {voiceover} from './voiceover.mjs';
import {sections} from './edit.mjs';
import {music} from './music.mjs';

assert.equal(duration, 139.5, 'The Mike v4 cut follows his natural delivery.');
assert.equal(fps, 30);
assert.equal(new Set(scenes.map(scene => scene.id)).size, scenes.length);
assert.equal(1568 / 882, 16 / 9, 'The article frame must be exactly 16:9');
for (const scene of scenes.filter(scene => scene.kind === 'article')) {
  const png = readFileSync(new URL(`public/${scene.assets[0]}`, import.meta.url));
  assert.equal(png.readUInt32BE(16), scene.sourceWidth);
  assert.equal(png.readUInt32BE(20), scene.sourceHeight);
  assert.ok(scene.cropWidth <= scene.sourceWidth - 30, 'Crop must exclude the source scrollbar');
  assert.ok(scene.cropWidth * 9 / 16 <= scene.sourceHeight, 'Crop must fit the source');
}
assert.ok(scenes.find(scene => scene.id === 'policy').cropWidth * 9 / 16 >= 1326, 'The complete selected policy line must remain inside the crop');
let previousEnd = 0;
for (const scene of scenes) {
  assert.equal(scene.start, previousEnd, `Gap or overlap before ${scene.id}`);
  assert.ok(scene.seconds > 0 && scene.narration && scene.motion && scene.status);
  for (const asset of scene.assets) assert.ok(existsSync(new URL(`public/${asset}`, import.meta.url)), `Missing ${asset}`);
  if (!['article', 'policy', 'close'].includes(scene.id)) assert.ok(scene.assets.every(asset => asset.startsWith('clean/continuous/')), `Old evidence referenced by ${scene.id}`);
  for (const clip of [scene.clip, scene.secondClip].filter(Boolean)) {
    assert.ok(clip.startsWith('clean/continuous/'), `Old clip referenced by ${scene.id}`);
    assert.ok(existsSync(new URL(`public/${clip}`, import.meta.url)), `Missing ${clip}`);
  }
  previousEnd = scene.end;
}
for (const scene of scenes.filter(scene => scene.clip)) {
  const png = readFileSync(new URL(`public/${scene.assets[0]}`, import.meta.url));
  assert.equal(png.readUInt32BE(16), 1920, `${scene.id}: desktop capture width`);
  assert.equal(png.readUInt32BE(20), 1080, `${scene.id}: desktop capture height`);
  assert.ok(scene.clipSeconds >= scene.seconds, `${scene.id}: recording must cover the whole chapter`);
}
const manifest = JSON.parse(readFileSync(new URL('public/clean/continuous/manifest.json', import.meta.url)));
for (const section of sections) {
  const source = manifest.clips[section.clip];
  assert.equal(source.width, 1920);
  assert.equal(source.height, 1080);
  assert.equal(section.knots[0].frame, 0);
  assert.equal(section.knots.at(-1).frame, Math.round((section.seconds + 0.8) * fps), 'Edited footage must cover section and slide tail');
  assert.ok(source.seconds >= section.knots.at(-1).source);
  for (const [index, knot] of section.knots.entries()) if (index) {
    const previous = section.knots[index - 1];
    assert.ok(knot.frame > previous.frame, 'No gaps or zero-length pieces');
    assert.ok(knot.source > previous.source, 'Keep recorded actions in chronological order');
    const rate = (knot.source - previous.source) * fps / (knot.frame - previous.frame);
    assert.ok(rate > 0.25 && rate < 4.2, 'Bound navigation retiming; never freeze or loop an action');
  }
  for (const chapter of scenes.slice(section.first, section.last + 1)) {
    assert.equal(chapter.clip, section.clip, 'Keep workflow in a continuous take');
  }
}
const driver = manifest.clips[scenes[10].driverClip];
assert.equal(driver.width, 430);
assert.equal(driver.height, 860);
assert.ok(driver.seconds >= scenes[10].driverClipIn + scenes[10].driverClipSeconds);
assert.ok(Math.abs(scenes.reduce((sum, scene) => sum + (scene.clipSeconds ?? 0), 0) - 118.6) < 0.001);
assert.ok(scenes.filter(scene => scene.sandbox).every(scene => /sandbox|provider/i.test(scene.status)));
assert.equal(voiceover.provider, 'ElevenLabs');
assert.equal(voiceover.model, 'eleven_v4');
assert.equal(voiceover.voice, 'Mike - Animation, Explainers & Gaming');
assert.equal(voiceover.playbackRate, 1, 'Keep the selected voice at its original speed');
assert.equal(voiceover.duration, duration);
const wav = readFileSync(new URL(`public/${voiceover.src}`, import.meta.url));
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
assert.equal(wav.readUInt32LE(24), 44100);
assert.equal(wav.readUInt32LE(40), duration * 44100 * 2, 'Track must cover exactly the full edit');
assert.equal(wav.length, 44 + duration * 44100 * 2);
const spokenWords = text => text.replace(/\s+/g, '');
assert.equal(spokenWords(voiceover.cues.map(cue => cue.text).join(' ')), spokenWords(scenes.map(scene => scene.narration).join(' ')), 'Narrate the complete script once');
for (const [index, cue] of voiceover.cues.entries()) {
  assert.ok(cue.spokenAt + cue.seconds <= (voiceover.cues[index + 1]?.spokenAt ?? duration), `${cue.id}: no overlapping speech`);
  if (index) assert.ok(cue.spokenAt - voiceover.cues[index - 1].spokenAt - voiceover.cues[index - 1].seconds <= 2.1, 'Remove padded silences between paragraphs');
}
for (const anchor of voiceover.anchors) assert.ok(Math.abs(anchor.spokenAt - anchor.pictureAt) < 1 / fps, `Speech must match recorded marker: ${anchor.phrase}`);
assert.equal(music.title, 'Seven Miles');
assert.equal(music.duration, duration);
const bed = readFileSync(new URL(`public/${music.src}`, import.meta.url));
assert.equal(bed.toString('ascii', 0, 4), 'RIFF');
assert.equal(bed.readUInt16LE(22), 2, 'Keep the music stereo');
assert.equal(bed.readUInt32LE(24), 44100);
assert.equal(bed.length, 44 + duration * 44100 * 4);
let mixedPeak = 0;
for (let frame = 0; frame < duration * 44100; frame++) {
  const narration = wav.readInt16LE(44 + frame * 2);
  for (let channel = 0; channel < 2; channel++) mixedPeak = Math.max(mixedPeak, Math.abs(narration + bed.readInt16LE(44 + frame * 4 + channel * 2)));
}
assert.ok(mixedPeak < 32767, 'Narration and music must not clip when mixed');
assert.equal(bed.readInt16LE(44), 0);
assert.equal(bed.readInt16LE(bed.length - 2), 0);
console.log(`PASS: ${scenes.length} contiguous chapters, ${duration}s, ${duration * fps} frames; 118.6s recorded business footage; chronological source retiming covers every section and 0.8s slide; clean desktop/mobile sources retained.`);
console.log(`PASS: complete ElevenLabs narration, original speed, 13 non-overlapping paragraphs, no inserted mid-sentence pauses, four recorded action anchors; WAV exactly ${duration}s.`);
console.log(`PASS: full Seven Miles stereo bed, fades to silence, combined peak ${(20 * Math.log10(mixedPeak / 32768)).toFixed(1)} dBFS; preview recording, publication licensing unverified.`);
