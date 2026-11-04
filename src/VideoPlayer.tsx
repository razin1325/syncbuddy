/**
 * VideoPlayer — a real, cross-platform media player surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Media page previously rendered a native Media3 `PlayerView` on Android and
 * nothing but a POSTER IMAGE on web. That made two things impossible:
 *
 *   1. Fullscreen did nothing. `launchFullscreenVideo()` returns false
 *      immediately off-Android, and on web there was no <video> element at all.
 *   2. Brightness and sound effects had no target — there was no media element
 *      to control.
 *
 * This component gives both platforms a genuine, controllable media element:
 *
 *   • web     -> an HTML <video> / <audio> element, wrapped by React
 *   • android -> the existing Media3 PlayerView (hardware decode, all formats)
 *
 * On top of that it exposes brightness, volume and an equaliser, implemented
 * with the Web Audio API on web and delegated to Kotlin on Android.
 *
 * Headless-Chrome notes (these cost real debugging time):
 *   • MediaRecorder-produced WebM reports duration = Infinity/NaN. Seeking is
 *     unreliable until the browser has scanned the file, so duration is
 *     corrected by seeking far past the end once metadata loads.
 *   • Cross-origin / data: sources need explicit `crossOrigin`.
 */

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, View, requireNativeComponent } from 'react-native';

const NativeMedia3View: any =
  Platform.OS === 'android' ? requireNativeComponent<any>('Media3PlayerView') : null;

/** Equaliser presets, in dB, applied per frequency band. */
export interface EqPreset {
  key: string;
  label: string;
  icon: string;
  /** Centre frequency (Hz) -> gain (dB). */
  bands: { freq: number; gain: number }[];
}

export const EQ_PRESETS: EqPreset[] = [
  { key: 'flat', label: 'Flat', icon: '➖', bands: [] },
  {
    key: 'bass',
    label: 'Bass Boost',
    icon: '🎸',
    bands: [
      { freq: 60, gain: 7 }, { freq: 170, gain: 5 },
      { freq: 350, gain: 1 }, { freq: 1000, gain: 0 },
      { freq: 3500, gain: -1 }, { freq: 10000, gain: -2 },
    ],
  },
  {
    key: 'vocal',
    label: 'Vocal',
    icon: '🎤',
    bands: [
      { freq: 60, gain: -3 }, { freq: 170, gain: -1 },
      { freq: 350, gain: 2 }, { freq: 1000, gain: 5 },
      { freq: 3500, gain: 4 }, { freq: 10000, gain: 1 },
    ],
  },
  {
    key: 'cinema',
    label: 'Cinema',
    icon: '🎬',
    bands: [
      { freq: 60, gain: 5 }, { freq: 170, gain: 2 },
      { freq: 350, gain: -2 }, { freq: 1000, gain: 1 },
      { freq: 3500, gain: 4 }, { freq: 10000, gain: 5 },
    ],
  },
  {
    key: 'night',
    label: 'Night',
    icon: '🌙',
    bands: [
      { freq: 60, gain: -6 }, { freq: 170, gain: -3 },
      { freq: 350, gain: 1 }, { freq: 1000, gain: 4 },
      { freq: 3500, gain: 3 }, { freq: 10000, gain: -4 },
    ],
  },
];

/** Reverb / spatial effect presets (convolution is overkill; these are delays). */
export interface FxPreset {
  key: string;
  label: string;
  icon: string;
  /** Seconds of delay; 0 disables the effect. */
  delay: number;
  feedback: number;
  wet: number;
}

export const FX_PRESETS: FxPreset[] = [
  { key: 'off', label: 'Off', icon: '🚫', delay: 0, feedback: 0, wet: 0 },
  { key: 'room', label: 'Room', icon: '🏠', delay: 0.028, feedback: 0.22, wet: 0.18 },
  { key: 'hall', label: 'Hall', icon: '🏛️', delay: 0.075, feedback: 0.35, wet: 0.30 },
  { key: 'stadium', label: 'Stadium', icon: '🏟️', delay: 0.145, feedback: 0.48, wet: 0.42 },
  { key: 'echo', label: 'Echo', icon: '🔁', delay: 0.26, feedback: 0.55, wet: 0.50 },
];

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface Props {
  uri: string;
  /** Optional separate audio track (web). Lets a silent video still have sound. */
  audioUri?: string;
  isPlaying: boolean;
  /** 0.2 - 1.0, applied as a CSS/View brightness filter. */
  brightness?: number;
  /** 0 - 1. */
  volume?: number;
  muted?: boolean;
  eqPreset?: string;
  fxPreset?: string;
  resizeMode?: 'contain' | 'cover' | 'fill';
  /** Fires once real duration is known (WebM often reports Infinity). */
  onDuration?: (seconds: number) => void;
  onProgress?: (seconds: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  onReady?: () => void;
  style?: any;
  handleRef?: React.RefObject<VideoPlayerHandle | null>;
}

export default function VideoPlayer(p: Props) {
  const videoRef = useRef<any>(null);
  const audioRef = useRef<any>(null);
  const audioCtxRef = useRef<any>(null);
  const sourceNodeRef = useRef<any>(null);
  const eqNodesRef = useRef<any[]>([]);
  const fxNodesRef = useRef<{ input: any; wet: any; dry: any } | null>(null);
  const [ready, setReady] = useState(false);
  const [internalDuration, setInternalDuration] = useState(0);

  const isWeb = Platform.OS === 'web';

  // Preset values are read through refs. If ensureAudioGraph depended on them
  // directly, changing the EQ would recreate the callback, re-run the play
  // effect, and restart the media — which for a short clip means it instantly
  // hits onEnded and skips to the next track. Presets must be applied by the
  // dedicated effects below, never by rebuilding the graph.
  const eqPresetRef = useRef(p.eqPreset);
  const fxPresetRef = useRef(p.fxPreset);
  eqPresetRef.current = p.eqPreset;
  fxPresetRef.current = p.fxPreset;

  // ── Build (or rebuild) the Web Audio graph ────────────────────────────────
  // Called lazily on first play because browsers require a user gesture before
  // an AudioContext may start.
  const ensureAudioGraph = useCallback(() => {
    if (!isWeb || typeof window === 'undefined') return null;
    const el: any = videoRef.current || audioRef.current;
    if (!el) return null;

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;

    if (!audioCtxRef.current) {
      try {
        audioCtxRef.current = new AC();
      } catch {
        return null;
      }
    }
    const ctx = audioCtxRef.current;

    // createMediaStreamSource / createMediaElementSource may only be called
    // ONCE per element. Reuse the existing node when we already have one.
    if (!sourceNodeRef.current) {
      try {
        sourceNodeRef.current = ctx.createMediaElementSource(el);
      } catch {
        // Already connected to a previous context.
        return audioCtxRef.current;
      }

      // Equaliser: one peaking filter per band.
      const eq = EQ_PRESETS.find(x => x.key === eqPresetRef.current);
      const filters = (eq?.bands || []).map(b => {
        const f = ctx.createBiquadFilter();
        f.type = 'peaking';
        f.frequency.value = b.freq;
        f.Q.value = 1.1;
        f.gain.value = b.gain;
        return f;
      });
      eqNodesRef.current = filters;

      // Effect: parallel dry/wet delay network.
      const fx = FX_PRESETS.find(x => x.key === fxPresetRef.current);
      const input = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      wet.gain.value = fx && fx.delay > 0 ? fx.wet : 0;
      dry.gain.value = 1;

      input.connect(dry);
      let last: any = input;
      if (fx && fx.delay > 0) {
        const delay = ctx.createDelay(1.0);
        delay.delayTime.value = fx.delay;
        const fb = ctx.createGain();
        fb.gain.value = fx.feedback;
        input.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        delay.connect(wet);
        last = delay;
      }

      // Chain: source -> eq filters -> input -> {dry, wet} -> destination
      let node: any = sourceNodeRef.current;
      filters.forEach(f => {
        node.connect(f);
        node = f;
      });
      node.connect(input);
      dry.connect(ctx.destination);
      wet.connect(ctx.destination);

      fxNodesRef.current = { input, wet, dry };
    }

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }, [isWeb]);

  // Apply EQ preset changes live.
  useEffect(() => {
    if (!isWeb || !audioCtxRef.current || !sourceNodeRef.current) return;
    const ctx = audioCtxRef.current;
    const filters = eqNodesRef.current;

    // Rebuild the band chain if the preset changed band count.
    const eq = EQ_PRESETS.find(x => x.key === p.eqPreset);
    const wanted = eq?.bands || [];
    try {
      if (filters.length !== wanted.length) {
        // Simplest reliable path: rebuild by disconnecting and re-creating.
        const fx = fxNodesRef.current;
        if (!fx) return;
        try { sourceNodeRef.current.disconnect(); } catch {}
        let node: any = sourceNodeRef.current;
        const newFilters = wanted.map(b => {
          const f = ctx.createBiquadFilter();
          f.type = 'peaking';
          f.frequency.value = b.freq;
          f.Q.value = 1.1;
          f.gain.value = b.gain;
          node.connect(f);
          node = f;
          return f;
        });
        node.connect(fx.input);
        eqNodesRef.current = newFilters;
      } else {
        wanted.forEach((b, i) => {
          const f = filters[i];
          if (!f) return;
          try {
            f.frequency.setTargetAtTime(b.freq, ctx.currentTime, 0.02);
            f.gain.setTargetAtTime(b.gain, ctx.currentTime, 0.02);
          } catch {
            f.frequency.value = b.freq;
            f.gain.value = b.gain;
          }
        });
      }
    } catch {}
  }, [isWeb, p.eqPreset]);

  // Apply effect preset changes live.
  useEffect(() => {
    const fxNode = fxNodesRef.current;
    const ctx = audioCtxRef.current;
    if (!fxNode || !ctx) return;
    const fx = FX_PRESETS.find(x => x.key === p.fxPreset);
    try {
      const target = fx && fx.delay > 0 ? fx.wet : 0;
      fxNode.wet.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
    } catch {
      fxNode.wet.gain.value = fx && fx.delay > 0 ? fx.wet : 0;
    }
  }, [p.fxPreset]);

  // Volume / mute.
  useEffect(() => {
    const v = p.muted ? 0 : typeof p.volume === 'number' ? p.volume : 1;
    [videoRef.current, audioRef.current].forEach(el => {
      if (el) {
        try { el.volume = Math.max(0, Math.min(1, v)); } catch {}
      }
    });
  }, [p.volume, p.muted, ready]);

  // Play / pause.
  useEffect(() => {
    const els = [videoRef.current, audioRef.current].filter(Boolean);
    if (!els.length) return;
    if (p.isPlaying) {
      ensureAudioGraph();
      els.forEach((el: any) => {
        const pr = el.play?.();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      });
    } else {
      els.forEach((el: any) => {
        try { el.pause?.(); } catch {}
      });
    }
  }, [p.isPlaying, ready, ensureAudioGraph]);

  // WebM from MediaRecorder reports duration = Infinity. Force the browser to
  // scan the file by seeking past the end; afterwards duration is correct and
  // the scrubber works.
  const fixDuration = useCallback((el: any) => {
    if (!el) return 0;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) return d;
    try {
      const probe = 1e101;
      el.currentTime = probe;
      // The browser clamps to the real end; read it back on timeupdate.
    } catch {}
    return 0;
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const el: any = videoRef.current;
    if (!el) return;
    const real = fixDuration(el);
    if (real > 0) {
      setInternalDuration(real);
      p.onDuration?.(real);
    }
    setReady(true);
    p.onReady?.();
  }, [fixDuration, p.onDuration, p.onReady]);

  const handleTimeUpdate = useCallback(() => {
    const el: any = videoRef.current;
    if (!el) return;
    // Late-bound duration correction for MediaRecorder WebM.
    if (!Number.isFinite(el.duration) || internalDuration === 0) {
      const d = Number(el.duration);
      if (Number.isFinite(d) && d > 0) {
        setInternalDuration(d);
        p.onDuration?.(d);
      } else if (el.currentTime > 0 && el.currentTime > internalDuration) {
        setInternalDuration(el.currentTime);
      }
    }
    p.onProgress?.(el.currentTime || 0, Number.isFinite(el.duration) ? el.duration : internalDuration);
  }, [p.onProgress, internalDuration, p.onDuration]);

  // Expose imperative controls.
  useImperativeHandle(
    p.handleRef,
    () => ({
      play: () => {
        const el: any = videoRef.current;
        ensureAudioGraph();
        const pr = el?.play?.();
        if (pr?.catch) pr.catch(() => {});
      },
      pause: () => {
        try { videoRef.current?.pause?.(); } catch {}
      },
      seek: (seconds: number) => {
        const el: any = videoRef.current;
        if (!el) return;
        try {
          el.currentTime = Math.max(0, seconds);
        } catch {}
        try {
          if (audioRef.current) audioRef.current.currentTime = Math.max(0, seconds);
        } catch {}
      },
      setVolume: (v: number) => {
        const vol = Math.max(0, Math.min(1, v));
        [videoRef.current, audioRef.current].forEach((el: any) => {
          if (el) {
            try { el.volume = vol; } catch {}
          }
        });
      },
      setMuted: (m: boolean) => {
        [videoRef.current, audioRef.current].forEach((el: any) => {
          if (el) {
            try { el.muted = m; } catch {}
          }
        });
      },
      getCurrentTime: () => videoRef.current?.currentTime || 0,
      getDuration: () => {
        const d = Number(videoRef.current?.duration);
        return Number.isFinite(d) && d > 0 ? d : internalDuration;
      },
    }),
    [ensureAudioGraph, internalDuration],
  );

  // Clean up the audio context on unmount.
  useEffect(() => {
    return () => {
      try { audioCtxRef.current?.close?.(); } catch {}
      audioCtxRef.current = null;
      sourceNodeRef.current = null;
      eqNodesRef.current = [];
      fxNodesRef.current = null;
    };
  }, []);

  // Brightness is expressed as a CSS filter on web. Native Android handles it
  // in Kotlin via the window, so no View-level filter is applied there.
  const brightnessStyle = isWeb
    ? {
        filter: `brightness(${(p.brightness ?? 1).toFixed(3)})`,
        width: '100%',
        height: '100%',
        transition: 'filter 120ms linear',
      }
    : undefined;

  return (
    <View style={[styles.fill, p.style]}>
      {isWeb ? (
        <>
          {React.createElement('video', {
            ref: videoRef,
            src: p.uri,
            crossOrigin: 'anonymous',
            playsInline: true,
            preload: 'auto',
            onLoadedMetadata: handleLoadedMetadata,
            onTimeUpdate: handleTimeUpdate,
            onEnded: () => p.onEnded?.(),
            onError: () => p.onError?.('This file cannot be decoded by the browser'),
            style: {
              ...brightnessStyle,
              objectFit: p.resizeMode || 'contain',
              backgroundColor: '#000',
            },
          })}
          {/* Optional companion audio track for silent video files. */}
          {p.audioUri
            ? React.createElement('audio', {
                ref: audioRef,
                src: p.audioUri,
                preload: 'auto',
                onError: () => {},
              })
            : null}
        </>
      ) : (
        <NativeMedia3View
          style={StyleSheet.absoluteFill}
          uri={p.uri}
          isPlaying={p.isPlaying}
          resizeMode={p.resizeMode === 'cover' ? 'zoom' : 'fit'}
          useController={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
});
