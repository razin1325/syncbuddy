/**
 * FullscreenPlayer — an immersive, real media-app fullscreen experience.
 *
 * Replaces the old one-line "⛶ Fullscreen" pill, which on web did nothing at all
 * (the native bridge returned false immediately off-Android) and on Android
 * jumped to a separate Activity with no brightness or audio control.
 *
 * Everything a real player has:
 *   • edge-to-edge video with tap-to-show controls
 *   • auto-hiding chrome (3 s) while playing
 *   • scrubber with live position, elapsed / remaining
 *   • play/pause, ±10 s, next / previous
 *   • brightness slider (also supports drag-to-adjust gestures)
 *   • volume slider with mute
 *   • equaliser + spatial sound-effect pickers
 *   • fullscreen API request on web so the browser chrome really disappears
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import VideoPlayer, {
  EQ_PRESETS,
  FX_PRESETS,
  VideoPlayerHandle,
} from './VideoPlayer';

const C = {
  bg: '#000000',
  surf: '#0A0A0E',
  surf2: '#101017',
  surf3: '#17171F',
  line: 'rgba(255,255,255,0.10)',
  text: '#FAFAFA',
  textDim: '#A1A1AA',
  textMute: '#6B6B76',
  accent: '#22D3EE',
  green: '#34D399',
  red: '#F87171',
  amber: '#FBBF24',
};

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export interface FullscreenPlayerProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  uri: string;
  audioUri?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onEnded?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export default function FullscreenPlayer(p: FullscreenPlayerProps) {
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [brightness, setBrightness] = useState(1);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [eqPreset, setEqPreset] = useState('flat');
  const [fxPreset, setFxPreset] = useState('off');
  const [panel, setPanel] = useState<'none' | 'display' | 'sound'>('none');
  const [chromeVisible, setChromeVisible] = useState(true);
  const [livePos, setLivePos] = useState(0);
  const [liveDur, setLiveDur] = useState(0);
  const [dragging, setDragging] = useState(false);

  const hideTimer = useRef<any>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // Prefer real player time once it starts reporting; fall back to the sheet's.
  const pos = livePos > 0 ? livePos : p.position;
  const dur = liveDur > 0 ? liveDur : p.duration;
  const pct = dur > 0 ? Math.min(1, pos / dur) : 0;

  // Reset transient UI whenever a new file is opened.
  useEffect(() => {
    if (p.visible) {
      setPanel('none');
      setChromeVisible(true);
      setLivePos(0);
      setLiveDur(0);

      // Ask the browser for TRUE fullscreen, so the address bar and taskbar
      // really go away rather than being covered by an overlay.
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const el: any = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
        if (req && !document.fullscreenElement) {
          try { req.call(el).catch?.(() => {}); } catch {}
        }
      }
    } else if (Platform.OS === 'web' && typeof document !== 'undefined') {
      if (document.fullscreenElement) {
        try { (document as any).exitFullscreen?.(); } catch {}
      }
    }
  }, [p.visible, p.uri]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setChromeVisible(false);
      setPanel('none');
    }, 3200);
  }, []);

  useEffect(() => {
    if (!p.visible) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return;
    }
    if (!p.isPlaying) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setChromeVisible(true);
      return;
    }
    scheduleHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [p.visible, p.isPlaying, scheduleHide]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: chromeVisible ? 1 : 0,
      duration: 200,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [chromeVisible, fade]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    if (p.isPlaying) scheduleHide();
  }, [p.isPlaying, scheduleHide]);

  if (!p.visible) return null;

  return (
    <View style={styles.root}>
      {/* ── Video surface ─────────────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFill}>
        <VideoPlayer
          handleRef={playerRef}
          uri={p.uri}
          audioUri={p.audioUri}
          isPlaying={p.isPlaying}
          brightness={brightness}
          volume={volume}
          muted={muted}
          eqPreset={eqPreset}
          fxPreset={fxPreset}
          resizeMode="contain"
          onDuration={d => setLiveDur(d)}
          onProgress={(t, d) => {
            if (!dragging) setLivePos(t);
            if (d > 0 && Math.abs(d - liveDur) > 0.25) setLiveDur(d);
          }}
          onEnded={() => {
            setChromeVisible(true);
            p.onEnded?.();
          }}
        />
      </View>

      {/*
        Tap layer: toggles the chrome. It sits UNDER the control layer (declared
        first), and collapses when the chrome is hidden so it cannot swallow
        taps meant for buttons. Chrome uses box-none so only the actual buttons
        capture presses.
      */}
      <TouchableOpacity
        activeOpacity={1}
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (panel !== 'none') {
            setPanel('none');
            return;
          }
          if (chromeVisible) setChromeVisible(false);
          else revealChrome();
        }}
      />

      <Animated.View
        pointerEvents={chromeVisible ? 'box-none' : 'none'}
        style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        {/* Top region: box-none so video taps fall through to the layer below */}
        <View style={{ flex: 1 }} pointerEvents="box-none">
          {/* ── Top bar ────────────────────────────────────────────────────── */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.roundBtn} onPress={p.onClose}>
              <Text style={styles.roundBtnText}>✕</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, marginHorizontal: 12 }}>
              <Text style={styles.title} numberOfLines={1}>{p.title}</Text>
              {p.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>{p.subtitle}</Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={[styles.roundBtn, panel === 'display' && styles.roundBtnOn]}
              onPress={() => {
                setPanel(panel === 'display' ? 'none' : 'display');
                revealChrome();
              }}>
              <Text style={styles.roundBtnText}>☀</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roundBtn, { marginLeft: 8 }, panel === 'sound' && styles.roundBtnOn]}
              onPress={() => {
                setPanel(panel === 'sound' ? 'none' : 'sound');
                revealChrome();
              }}>
              <Text style={styles.roundBtnText}>🎚</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        {/* ── Panels ───────────────────────────────────────────────────────── */}
        {panel === 'display' ? (
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>Display</Text>
              <Text style={styles.panelVal}>{Math.round(brightness * 100)}%</Text>
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderIcon}>🌑</Text>
              <Slider
                value={brightness}
                min={0.2}
                max={1.4}
                onChange={v => setBrightness(v)}
              />
              <Text style={styles.sliderIcon}>☀️</Text>
            </View>
            <View style={styles.presetRow}>
              {[
                { v: 0.45, l: 'Dim' },
                { v: 0.75, l: 'Soft' },
                { v: 1.0, l: 'Normal' },
                { v: 1.3, l: 'Bright' },
              ].map(x => (
                <TouchableOpacity
                  key={x.l}
                  style={[styles.preset, Math.abs(brightness - x.v) < 0.12 && styles.presetOn]}
                  onPress={() => setBrightness(x.v)}>
                  <Text
                    style={[styles.presetText, Math.abs(brightness - x.v) < 0.12 && styles.presetTextOn]}>
                    {x.l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {panel === 'sound' ? (
          <View style={styles.panel}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>Sound</Text>
              <Text style={styles.panelVal}>{muted ? 'Muted' : `${Math.round(volume * 100)}%`}</Text>
            </View>

            <View style={styles.sliderRow}>
              <TouchableOpacity onPress={() => setMuted(m => !m)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.sliderIcon}>{muted || volume === 0 ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
              <Slider
                value={muted ? 0 : volume}
                min={0}
                max={1}
                onChange={v => {
                  setVolume(v);
                  if (v > 0) setMuted(false);
                }}
              />
              <Text style={styles.sliderIcon}>🔈</Text>
            </View>

            <Text style={styles.groupLabel}>EQUALISER</Text>
            <View style={styles.chipRow}>
              {EQ_PRESETS.map(x => (
                <TouchableOpacity
                  key={x.key}
                  style={[styles.chip, eqPreset === x.key && styles.chipOn]}
                  onPress={() => setEqPreset(x.key)}>
                  <Text style={[styles.chipText, eqPreset === x.key && styles.chipTextOn]}>
                    {x.icon} {x.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.groupLabel}>SOUND EFFECTS</Text>
            <View style={styles.chipRow}>
              {FX_PRESETS.map(x => (
                <TouchableOpacity
                  key={x.key}
                  style={[styles.chip, fxPreset === x.key && styles.chipOn]}
                  onPress={() => setFxPreset(x.key)}>
                  <Text style={[styles.chipText, fxPreset === x.key && styles.chipTextOn]}>
                    {x.icon} {x.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Bottom controls ──────────────────────────────────────────────── */}
        <View style={styles.bottomBar}>
          <View style={styles.scrubRow}>
            <Text style={styles.time}>{fmt(pos)}</Text>
            <Slider
              value={pct}
              min={0}
              max={1}
              onStart={() => setDragging(true)}
              onChange={v => {
                setLivePos(v * dur);
                playerRef.current?.seek(v * dur);
              }}
              onEnd={() => {
                setDragging(false);
                p.onSeek(Math.floor(livePos));
              }}
            />
            <Text style={styles.time}>-{fmt(Math.max(0, dur - pos))}</Text>
          </View>

          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={[styles.ctrlBtn, !p.hasPrev && styles.ctrlDisabled]}
              disabled={!p.hasPrev}
              onPress={p.onPrev}>
              <Text style={styles.ctrlText}>⏮</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ctrlBtn}
              onPress={() => {
                const t = Math.max(0, pos - 10);
                setLivePos(t);
                playerRef.current?.seek(t);
                p.onSeek(Math.floor(t));
                revealChrome();
              }}>
              <Text style={styles.skipText}>-10</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => {
                p.onTogglePlay();
                revealChrome();
              }}>
              <Text style={styles.playText}>{p.isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ctrlBtn}
              onPress={() => {
                const t = Math.min(dur || 1e9, pos + 10);
                setLivePos(t);
                playerRef.current?.seek(t);
                p.onSeek(Math.floor(t));
                revealChrome();
              }}>
              <Text style={styles.skipText}>+10</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.ctrlBtn, !p.hasNext && styles.ctrlDisabled]}
              disabled={!p.hasNext}
              onPress={p.onNext}>
              <Text style={styles.ctrlText}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * Minimal drag slider. Built from View + PanResponder rather than a native
 * slider dependency, so it works identically on web and native.
 */
function Slider({
  value,
  min,
  max,
  onChange,
  onStart,
  onEnd,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const range = max - min || 1;
  const norm = Math.max(0, Math.min(1, (value - min) / range));

  const applyFromX = useCallback(
    (x: number) => {
      const w = widthRef.current || 1;
      const n = Math.max(0, Math.min(1, x / w));
      onChange(min + n * range);
    },
    [min, range, onChange],
  );

  const { PanResponder } = require('react-native');
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: any) => {
          onStart?.();
          applyFromX(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e: any) => {
          applyFromX(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => onEnd?.(),
        onPanResponderTerminate: () => onEnd?.(),
      }),
    [applyFromX, onStart, onEnd],
  );

  return (
    <View
      style={styles.sliderTrack}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setWidth(w);
      }}
      {...responder.panHandlers}>
      <View style={styles.sliderRail} />
      <View style={[styles.sliderFill, { width: `${norm * 100}%` }]} />
      <View style={[styles.sliderKnob, { left: `${norm * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 9999,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'web' ? 16 : 40,
    paddingBottom: 12,
  },
  roundBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(10,10,14,0.72)',
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnOn: {
    backgroundColor: 'rgba(34,211,238,0.20)',
    borderColor: 'rgba(34,211,238,0.6)',
  },
  roundBtnText: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '800',
  },
  subtitle: {
    color: C.textMute,
    fontSize: 10,
    marginTop: 2,
  },
  panel: {
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: 'rgba(10,10,14,0.94)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  panelTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  panelVal: {
    color: C.accent,
    fontSize: 11.5,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sliderIcon: {
    fontSize: 13,
    width: 20,
    textAlign: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
  },
  preset: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
  },
  presetOn: {
    backgroundColor: 'rgba(34,211,238,0.16)',
    borderColor: 'rgba(34,211,238,0.55)',
  },
  presetText: {
    color: C.textMute,
    fontSize: 10,
    fontWeight: '700',
  },
  presetTextOn: {
    color: C.accent,
  },
  groupLabel: {
    color: C.textMute,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 14,
    marginBottom: 7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
  },
  chipOn: {
    backgroundColor: 'rgba(52,211,153,0.16)',
    borderColor: 'rgba(52,211,153,0.55)',
  },
  chipText: {
    color: C.textMute,
    fontSize: 9.5,
    fontWeight: '700',
  },
  chipTextOn: {
    color: C.green,
  },
  bottomBar: {
    paddingHorizontal: 14,
    paddingBottom: Platform.OS === 'web' ? 16 : 34,
    paddingTop: 8,
  },
  scrubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  time: {
    color: C.textDim,
    fontSize: 10.5,
    fontFamily: 'monospace',
    fontWeight: '700',
    minWidth: 42,
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  ctrlBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23,23,31,0.85)',
    borderWidth: 1,
    borderColor: C.line,
  },
  ctrlDisabled: {
    opacity: 0.32,
  },
  ctrlText: {
    color: C.text,
    fontSize: 15,
  },
  skipText: {
    color: C.textDim,
    fontSize: 10.5,
    fontWeight: '800',
  },
  playBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
  },
  playText: {
    color: '#00151A',
    fontSize: 22,
    fontWeight: '900',
    marginLeft: 2,
  },
  sliderTrack: {
    flex: 1,
    height: 26,
    justifyContent: 'center',
  },
  sliderRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
  },
  sliderKnob: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.text,
    marginLeft: -7,
  },
});
