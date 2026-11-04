/**
 * FullscreenPlayer — True Immersive Edge-to-Edge Video Player
 *
 * User-first UX:
 *   • Pure 100% video display with zero UI clutter by default
 *   • Single screen tap toggles controls (Tap -> Show, Tap again -> Hide)
 *   • Auto-hides controls after 3.5s of inactivity while playing
 *   • Dedicated Rotate button (🔄 Rotate) to effortlessly switch between Portrait and Landscape
 *   • Double-tap left/right for quick ±10s seeking with visual feedback
 *   • Full landscape & portrait auto-orientation adaptation
 *   • Clean top bar (Back button, Title, 🔄 Rotate button, Aspect ratio switch: Fit / Zoom / Stretch)
 *   • Center overlay (⏪ 10s, Large Play/Pause, 10s ⏩)
 *   • Bottom bar (Time, Smooth Interactive Scrubber, Duration, Prev/Next, 🔄 Rotate)
 *   • Auto-hiding Android StatusBar for true cinematic immersion
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import VideoPlayer, {
  EQ_PRESETS,
  FX_PRESETS,
  VideoPlayerHandle,
} from './VideoPlayer';
import { NativeNetwork } from './NativeNetwork';

const C = {
  bg: '#000000',
  surf: '#0A0A0E',
  surf2: '#12121A',
  line: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF',
  textDim: '#CBD5E1',
  textMute: '#94A3B8',
  accent: '#06B6D4',
  accentGlow: 'rgba(6, 182, 212, 0.35)',
  scrim: 'rgba(0, 0, 0, 0.75)',
};

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
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
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [resizeMode, setResizeMode] = useState<'fit' | 'zoom' | 'fill'>('fit');
  const [panel, setPanel] = useState<'none' | 'sound'>('none');
  const [eqPreset, setEqPreset] = useState('flat');
  const [fxPreset, setFxPreset] = useState('off');
  const [volume, setVolume] = useState(1.0);
  const [muted, setMuted] = useState(false);

  const [livePos, setLivePos] = useState(0);
  const [liveDur, setLiveDur] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Quick visual feedback on double-tap seek or rotation
  const [seekFeedback, setSeekFeedback] = useState<{
    text: string;
    side: 'left' | 'right' | 'center';
  } | null>(null);
  const seekFeedbackTimer = useRef<any>(null);
  const lastTapRef = useRef<number>(0);
  const tapTimeoutRef = useRef<any>(null);

  const hideTimer = useRef<any>(null);
  const fade = useRef(new Animated.Value(1)).current;

  const pos = livePos > 0 ? livePos : p.position;
  const dur = liveDur > 0 ? liveDur : p.duration;
  const pct = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;

  // Clear hide timer
  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  // Schedule auto-hide of controls after 3.5s
  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setChromeVisible(false);
      setPanel('none');
    }, 3500);
  }, [clearHideTimer]);

  // Show chrome and start auto-hide timer if playing
  const showControls = useCallback(() => {
    setChromeVisible(true);
    if (p.isPlaying) {
      scheduleHide();
    } else {
      clearHideTimer();
    }
  }, [p.isPlaying, scheduleHide, clearHideTimer]);

  // Hide chrome immediately
  const hideControls = useCallback(() => {
    clearHideTimer();
    setChromeVisible(false);
    setPanel('none');
  }, [clearHideTimer]);

  // Toggle controls on single screen tap
  const toggleControls = useCallback(() => {
    if (panel !== 'none') {
      setPanel('none');
      return;
    }
    if (chromeVisible) {
      hideControls();
    } else {
      showControls();
    }
  }, [chromeVisible, panel, hideControls, showControls]);

  // Visual feedback popup helper
  const showSeekFeedback = useCallback((text: string, side: 'left' | 'right' | 'center') => {
    if (seekFeedbackTimer.current) clearTimeout(seekFeedbackTimer.current);
    setSeekFeedback({ text, side });
    seekFeedbackTimer.current = setTimeout(() => {
      setSeekFeedback(null);
    }, 900);
  }, []);

  // Toggle Screen Orientation between Landscape and Portrait
  const toggleOrientation = useCallback(async () => {
    const next = isLandscape ? 'portrait' : 'landscape';
    await NativeNetwork.setScreenOrientation(next);
    showSeekFeedback(next === 'landscape' ? '🔄 Landscape Mode' : '🔄 Portrait Mode', 'center');
    showControls();
  }, [isLandscape, showSeekFeedback, showControls]);

  // Close player and restore sensor orientation
  const handleClose = useCallback(async () => {
    try {
      await NativeNetwork.setScreenOrientation('unspecified');
    } catch {}
    p.onClose();
  }, [p]);

  // Sync animation fade with chromeVisible
  useEffect(() => {
    Animated.timing(fade, {
      toValue: chromeVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [chromeVisible, fade]);

  // Manage auto-hide on playback state changes
  useEffect(() => {
    if (!p.visible) {
      clearHideTimer();
      return;
    }
    if (p.isPlaying && chromeVisible && panel === 'none') {
      scheduleHide();
    } else if (!p.isPlaying) {
      clearHideTimer();
      setChromeVisible(true);
    }
    return () => clearHideTimer();
  }, [p.visible, p.isPlaying, chromeVisible, panel, scheduleHide, clearHideTimer]);

  // Reset state when opening a new video
  useEffect(() => {
    if (p.visible) {
      setChromeVisible(true);
      setPanel('none');
      setLivePos(0);
      setLiveDur(0);

      // Web: enter true fullscreen mode
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const el: any = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
        if (req && !document.fullscreenElement) {
          try { req.call(el).catch?.(() => {}); } catch {}
        }
      }
    } else {
      NativeNetwork.setScreenOrientation('unspecified').catch(() => {});
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        if (document.fullscreenElement) {
          try { (document as any).exitFullscreen?.(); } catch {}
        }
      }
    }
  }, [p.visible, p.uri]);

  // Restore sensor orientation on unmount
  useEffect(() => {
    return () => {
      NativeNetwork.setScreenOrientation('unspecified').catch(() => {});
    };
  }, []);

  // Relative seek (±10s)
  const seekRelative = useCallback((delta: number) => {
    const target = Math.max(0, Math.min(dur || 1e9, pos + delta));
    setLivePos(target);
    playerRef.current?.seek(target);
    p.onSeek(Math.floor(target));
    showControls();
  }, [dur, pos, p, showControls]);

  // Screen touch handler: detects single tap (toggle controls) and double tap (seek ±10s)
  const handleTouch = useCallback((evt: any) => {
    const x = evt.nativeEvent.locationX;
    const screenWidth = winWidth;
    const now = Date.now();
    const timeDelta = now - lastTapRef.current;
    lastTapRef.current = now;

    if (timeDelta < 300) {
      // Double tap detected!
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }
      if (x < screenWidth * 0.4) {
        // Double tap LEFT -> Rewind 10s
        seekRelative(-10);
        showSeekFeedback('-10s ⏪', 'left');
      } else if (x > screenWidth * 0.6) {
        // Double tap RIGHT -> Forward 10s
        seekRelative(10);
        showSeekFeedback('⏩ +10s', 'right');
      } else {
        // Double tap center -> toggle Play/Pause
        p.onTogglePlay();
        showControls();
      }
    } else {
      // Single tap candidate: wait 280ms before toggling controls to allow double-tap
      tapTimeoutRef.current = setTimeout(() => {
        toggleControls();
      }, 280);
    }
  }, [winWidth, seekRelative, p, showControls, toggleControls, showSeekFeedback]);

  // Cycle aspect ratio
  const cycleResizeMode = () => {
    setResizeMode(curr => {
      if (curr === 'fit') return 'zoom';
      if (curr === 'zoom') return 'fill';
      return 'fit';
    });
    showControls();
  };

  const resizeModeLabel = resizeMode === 'fit' ? '🔲 Fit' : resizeMode === 'zoom' ? '🔳 Zoom' : '↔️ Fill';

  if (!p.visible) return null;

  return (
    <View style={styles.root}>
      {/* Auto-hide Status Bar when controls are hidden for true edge-to-edge experience */}
      <StatusBar
        hidden={!chromeVisible}
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      {/* ── 1. Video Canvas (Always 100% full screen) ───────────────────────── */}
      <View style={StyleSheet.absoluteFill}>
        <VideoPlayer
          handleRef={playerRef}
          uri={p.uri}
          audioUri={p.audioUri}
          isPlaying={p.isPlaying}
          brightness={1.0}
          volume={volume}
          muted={muted}
          eqPreset={eqPreset}
          fxPreset={fxPreset}
          resizeMode={resizeMode}
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

      {/* ── 2. Full-surface Tap Detector ───────────────────────────────────── */}
      {/* Tapping anywhere toggles controls, double-tap seeks ±10s */}
      <TouchableWithoutFeedback onPress={handleTouch}>
        <View style={StyleSheet.absoluteFill}>
          {/* Double-tap or rotate visual indicator badge */}
          {seekFeedback && (
            <View
              style={[
                styles.seekFeedbackBox,
                seekFeedback.side === 'left'
                  ? styles.seekFeedbackLeft
                  : seekFeedback.side === 'right'
                  ? styles.seekFeedbackRight
                  : styles.seekFeedbackCenter,
              ]}>
              <Text style={styles.seekFeedbackText}>{seekFeedback.text}</Text>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* ── 3. Floating Overlay Controls ───────────────────────────────────── */}
      {chromeVisible && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: fade }]}
          pointerEvents="box-none">

          {/* ── Top Bar Scrim ── */}
          <View
            style={[
              styles.topBar,
              {
                paddingTop: isLandscape ? 14 : (Platform.OS === 'android' ? 36 : 46),
                paddingHorizontal: isLandscape ? 28 : 16,
              },
            ]}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={handleClose}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
              <Text style={styles.backBtnText}>←</Text>
            </TouchableOpacity>

            <View style={styles.titleArea}>
              <Text style={styles.titleText} numberOfLines={1}>
                {p.title}
              </Text>
              {p.subtitle ? (
                <Text style={styles.subtitleText} numberOfLines={1}>
                  {p.subtitle}
                </Text>
              ) : null}
            </View>

            {/* 🔄 Rotate Screen Button (Portrait ⇄ Landscape) */}
            <TouchableOpacity
              style={[styles.chipBtn, styles.rotateChipBtn]}
              onPress={toggleOrientation}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
              <Text style={styles.rotateChipText}>
                🔄 {isLandscape ? 'Portrait' : 'Rotate'}
              </Text>
            </TouchableOpacity>

            {/* Aspect Ratio Toggle (Fit / Zoom / Stretch) */}
            <TouchableOpacity
              style={styles.chipBtn}
              onPress={cycleResizeMode}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
              <Text style={styles.chipBtnText}>{resizeModeLabel}</Text>
            </TouchableOpacity>

            {/* Sound FX Toggle */}
            <TouchableOpacity
              style={[styles.iconBtn, panel === 'sound' && styles.iconBtnOn]}
              onPress={() => {
                setPanel(curr => (curr === 'sound' ? 'none' : 'sound'));
                showControls();
              }}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
              <Text style={styles.iconBtnText}>🎚</Text>
            </TouchableOpacity>
          </View>

          {/* Sound / Equalizer Drawer (when open) */}
          {panel === 'sound' && (
            <View
              style={[
                styles.soundDrawer,
                { marginHorizontal: isLandscape ? 60 : 16 },
              ]}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Sound Effects & EQ</Text>
                <TouchableOpacity onPress={() => setMuted(m => !m)}>
                  <Text style={styles.muteBtnText}>{muted ? '🔇 Unmute' : '🔊 Mute'}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.drawerSectionLabel}>PRESETS</Text>
              <View style={styles.eqRow}>
                {EQ_PRESETS.map(x => (
                  <TouchableOpacity
                    key={x.key}
                    style={[styles.eqChip, eqPreset === x.key && styles.eqChipActive]}
                    onPress={() => {
                      setEqPreset(x.key);
                      showControls();
                    }}>
                    <Text style={[styles.eqChipText, eqPreset === x.key && styles.eqChipTextActive]}>
                      {x.icon} {x.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* ── Center Quick Controls (⏪ 10s, Play/Pause, 10s ⏩) ── */}
          <View style={styles.centerRow} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.centerSkipBtn}
              onPress={() => seekRelative(-10)}
              activeOpacity={0.75}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.centerSkipIcon}>⏪</Text>
              <Text style={styles.centerSkipText}>-10s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.centerPlayBtn}
              onPress={() => {
                p.onTogglePlay();
                showControls();
              }}
              activeOpacity={0.85}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
              <Text style={styles.centerPlayIcon}>{p.isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.centerSkipBtn}
              onPress={() => seekRelative(10)}
              activeOpacity={0.75}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.centerSkipIcon}>⏩</Text>
              <Text style={styles.centerSkipText}>+10s</Text>
            </TouchableOpacity>
          </View>

          {/* ── Bottom Bar Scrim (Scrubber, Timestamps, Playlist Nav, Rotate) ── */}
          <View
            style={[
              styles.bottomBar,
              {
                paddingBottom: isLandscape ? 16 : 28,
                paddingHorizontal: isLandscape ? 28 : 16,
              },
            ]}>
            {/* Scrubber row with live elapsed and total duration */}
            <View style={styles.scrubberRow}>
              <Text style={styles.timeLabel}>{fmt(pos)}</Text>
              <View style={styles.sliderFlex}>
                <Slider
                  value={pct}
                  min={0}
                  max={1}
                  onStart={() => {
                    setDragging(true);
                    clearHideTimer();
                  }}
                  onChange={v => {
                    setLivePos(v * dur);
                  }}
                  onEnd={() => {
                    setDragging(false);
                    p.onSeek(Math.floor(livePos));
                    showControls();
                  }}
                />
              </View>
              <Text style={styles.timeLabel}>{fmt(dur)}</Text>
            </View>

            {/* Bottom buttons row */}
            <View style={styles.bottomButtonsRow}>
              <View style={styles.bottomNavLeft}>
                {p.hasPrev ? (
                  <TouchableOpacity
                    style={styles.navBtn}
                    onPress={() => {
                      p.onPrev?.();
                      showControls();
                    }}>
                    <Text style={styles.navBtnText}>⏮ Prev</Text>
                  </TouchableOpacity>
                ) : null}

                {p.hasNext ? (
                  <TouchableOpacity
                    style={[styles.navBtn, { marginLeft: 8 }]}
                    onPress={() => {
                      p.onNext?.();
                      showControls();
                    }}>
                    <Text style={styles.navBtnText}>Next ⏭</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={styles.bottomNavRight}>
                {/* Bottom 🔄 Rotate Button */}
                <TouchableOpacity
                  style={[styles.navBtn, styles.bottomRotateBtn]}
                  onPress={toggleOrientation}>
                  <Text style={styles.bottomRotateText}>
                    🔄 {isLandscape ? 'Portrait' : 'Rotate'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={cycleResizeMode}>
                  <Text style={styles.navBtnText}>{resizeModeLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * High-performance, cross-platform touch scrubber built with PanResponder.
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
      style={styles.sliderHitBox}
      onLayout={e => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}>
      <View style={styles.sliderRail} />
      <View style={[styles.sliderFill, { width: `${norm * 100}%` }]} />
      <View style={[styles.sliderThumb, { left: `${norm * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },

  // ── Top Bar ────────────────────────────────────────────────────────────────
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingBottom: 14,
    zIndex: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    lineHeight: 24,
  },
  titleArea: {
    flex: 1,
    marginHorizontal: 12,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subtitleText: {
    color: C.textMute,
    fontSize: 11,
    marginTop: 2,
  },
  chipBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    marginRight: 8,
  },
  chipBtnText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  rotateChipBtn: {
    backgroundColor: 'rgba(6, 182, 212, 0.22)',
    borderColor: C.accent,
  },
  rotateChipText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnOn: {
    backgroundColor: C.accent,
  },
  iconBtnText: {
    fontSize: 16,
  },

  // ── Center Controls ────────────────────────────────────────────────────────
  centerRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  centerPlayBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 36,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  centerPlayIcon: {
    color: '#050811',
    fontSize: 34,
    fontWeight: '900',
    marginLeft: 3,
  },
  centerSkipBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0, 0, 0, 0.60)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSkipIcon: {
    fontSize: 18,
    color: '#FFFFFF',
  },
  centerSkipText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },

  // ── Double-tap & Rotate Feedback ───────────────────────────────────────────
  seekFeedbackBox: {
    position: 'absolute',
    top: '38%',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekFeedbackLeft: {
    left: '12%',
  },
  seekFeedbackRight: {
    right: '12%',
  },
  seekFeedbackCenter: {
    left: '28%',
    right: '28%',
  },
  seekFeedbackText: {
    color: C.accent,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },

  // ── Bottom Bar ─────────────────────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.70)',
    paddingTop: 12,
    zIndex: 20,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderFlex: {
    flex: 1,
    marginHorizontal: 10,
  },
  timeLabel: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 46,
    textAlign: 'center',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  bottomNavLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomNavRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  navBtnText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontWeight: '600',
  },
  bottomRotateBtn: {
    backgroundColor: 'rgba(6, 182, 212, 0.20)',
    borderColor: C.accent,
    borderWidth: 1,
    marginRight: 8,
  },
  bottomRotateText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
  },

  // ── Slider ─────────────────────────────────────────────────────────────────
  sliderHitBox: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderRail: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    width: '100%',
  },
  sliderFill: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: C.accent,
    top: 16,
    left: 0,
  },
  sliderThumb: {
    position: 'absolute',
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: C.accent,
    marginLeft: -8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 4,
  },

  // ── Sound Drawer ───────────────────────────────────────────────────────────
  soundDrawer: {
    position: 'absolute',
    top: 90,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    padding: 16,
    zIndex: 25,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  drawerTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  muteBtnText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  drawerSectionLabel: {
    color: C.textMute,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  eqRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  eqChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  eqChipActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.25)',
    borderColor: C.accent,
  },
  eqChipText: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  eqChipTextActive: {
    color: C.accent,
  },
});
