import React from 'react';
import {Audio, Video} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {slide} from '@remotion/transitions/slide';
import {AbsoluteFill, Composition, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {duration, scenes} from '../scenes.mjs';
import {sections} from '../edit.mjs';
import {voiceover} from '../voiceover.mjs';
import {music} from '../music.mjs';

const cream = '#f3f2e9';
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'};

function Background() {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  return <AbsoluteFill>
    <Img src={staticFile('grass.jpg')} style={{width: '100%', height: '100%', objectFit: 'cover', scale: interpolate(frame, [0, durationInFrames], [1.04, 1.075], clamp)}} />
    <AbsoluteFill style={{background: 'linear-gradient(90deg,rgba(3,21,20,.72),rgba(3,21,20,.38)),linear-gradient(0deg,rgba(3,21,20,.7),transparent 40%)'}} />
  </AbsoluteFill>;
}

function Article({scene}) {
  const scale = 1568 / scene.cropWidth;
  return <div style={{position: 'absolute', left: 176, top: 112, width: 1568, height: 882, overflow: 'hidden', background: '#fff', borderRadius: 14, boxShadow: '0 28px 90px #0006'}}>
    <Img src={staticFile(scene.assets[0])} style={{display: 'block', width: scene.sourceWidth * scale, height: scene.sourceHeight * scale, maxWidth: 'none'}} />
  </div>;
}

function Driver() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scene = scenes[10];
  return <div style={{position: 'absolute', left: 1400, top: 180, width: 300, height: 600, overflow: 'hidden', borderRadius: 20, background: '#fff', boxShadow: '0 20px 60px #0008', translate: `${interpolate(frame, [0, 0.8 * fps], [400, 0], clamp)}px 0px`}}>
    <Video src={staticFile(scene.driverClip)} trimBefore={Math.round(scene.driverClipIn * fps)} premountFor={fps} muted style={{width: '100%', height: '100%', objectFit: 'contain'}} />
  </div>;
}

function LiveSection({first, last}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const section = scenes[first];
  const edit = sections.find(section => section.first === first);
  const chapter = scenes.slice(first, last + 1).find(scene => frame < (scene.end - section.start) * fps) ?? scenes[last];
  const scale = section.id === 'checkout' ? interpolate(frame, [section.completionAt * fps, (section.completionAt + 0.6) * fps], [1, 1.8], clamp) : 1;
  return <AbsoluteFill>
    <div style={{position: 'absolute', top: 43, left: 128, fontSize: 24}}>{chapter.title}</div>
    <div style={{position: 'absolute', left: 176, top: 112, width: 1568, height: 882, borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 24px 70px #0007'}}>
      {edit.knots.slice(0, -1).map((knot, index) => <Sequence key={knot.frame} name={`Recorded footage ${index + 1}`} from={knot.frame} durationInFrames={edit.knots[index + 1].frame - knot.frame} premountFor={fps}>
        <Video src={staticFile(section.clip)} trimBefore={Math.round(knot.source * fps)} playbackRate={(edit.knots[index + 1].source - knot.source) * fps / (edit.knots[index + 1].frame - knot.frame)} premountFor={fps} muted style={{width: '100%', height: '100%', objectFit: 'contain', scale}} />
      </Sequence>)}
    </div>
    {section.id === 'confirm' && <Sequence name="Live mobile driver view" from={Math.round((scenes[10].start - section.start) * fps)} durationInFrames={Math.round(scenes[10].driverClipSeconds * fps)} premountFor={fps}><Driver /></Sequence>}
  </AbsoluteFill>;
}

function Close() {
  return <div style={{position: 'absolute', left: 225, top: 200}}>
    <div style={{fontSize: 130, fontWeight: 600, letterSpacing: -7, marginBottom: 44}}>Tally</div>
    <div style={{fontSize: 65, letterSpacing: -2, lineHeight: 1.32}}>Can this delivery go out?</div>
  </div>;
}

function Scene({scene}) {
  return <AbsoluteFill>
    {scene.kind !== 'close' && <div style={{position: 'absolute', top: 43, left: 128, fontSize: 24}}>{scene.title}</div>}
    {scene.kind === 'article' && <Article scene={scene} />}
    {scene.kind === 'close' && <Close />}
  </AbsoluteFill>;
}

function Film() {
  const {fps} = useVideoConfig();
  const transitionFrames = Math.round(0.8 * fps);
  const pageTiming = linearTiming({durationInFrames: transitionFrames, easing: Easing.inOut(Easing.cubic)});
  const pageSlide = slide({direction: 'from-right'});
  return <AbsoluteFill style={{fontFamily: 'Arial, sans-serif', background: '#102a26', color: cream}}>
    <Background />
    <Audio src={staticFile(voiceover.src)} premountFor={fps} />
    <Audio src={staticFile(music.src)} premountFor={fps} />
    <TransitionSeries>
      <TransitionSeries.Sequence name="CNA headline" durationInFrames={Math.round(scenes[0].seconds * fps) + transitionFrames} premountFor={fps}><Scene scene={scenes[0]} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Policy highlight" durationInFrames={Math.round(scenes[1].seconds * fps) + transitionFrames} premountFor={fps}><Scene scene={scenes[1]} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Import, review and approve" durationInFrames={Math.round((scenes[4].end - scenes[2].start) * fps) + transitionFrames} premountFor={fps}><LiveSection first={2} last={4} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Evaluate and approve pay-first" durationInFrames={Math.round((scenes[6].end - scenes[5].start) * fps) + transitionFrames} premountFor={fps}><LiveSection first={5} last={6} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Hosted checkout and sandbox payment" durationInFrames={Math.round((scenes[8].end - scenes[7].start) * fps) + transitionFrames} premountFor={fps}><LiveSection first={7} last={8} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Confirm, release, driver and old debt" durationInFrames={Math.round((scenes[10].end - scenes[9].start) * fps) + transitionFrames} premountFor={fps}><LiveSection first={9} last={10} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Scroll the audit" durationInFrames={Math.round(scenes[11].seconds * fps) + transitionFrames} premountFor={fps}><LiveSection first={11} last={11} /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={pageSlide} timing={pageTiming} />
      <TransitionSeries.Sequence name="Closing quote" durationInFrames={Math.round(scenes[12].seconds * fps)} premountFor={fps}><Scene scene={scenes[12]} /></TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>;
}

export function Root() {
  return <Composition id="TallyStoryboard" component={Film} width={1920} height={1080} fps={30} durationInFrames={duration * 30} />;
}
