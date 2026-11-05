/**
 * FullscreenPlayer — True VLC / MX Player Style Edge-to-Edge Experience
 *
 * Professional Media Player Capabilities:
 *   • True 100% Immersive Fullscreen (Zero margins, hides status bar & navigation pill)
 *   • Real-time Hardware + Software Brightness swipe on RIGHT half of screen (with visual black-tint overlay)
 *   • Real-time Volume swipe on LEFT half of screen
 *   • Completely clean video area: NO annoying popup text or giant seek boxes blocking the subtitles / video
 *   • Smooth touch & drag scrubber (never resets to 0:00)
 *   • Landscape auto-fills widescreen (resizeMode="zoom"), portrait centers in natural aspect ratio (resizeMode="fit")
 *   • Tap anywhere on screen to smoothly show/hide controls (auto-hides after 3.5s of playback)
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
  useWindowDimensions,
  View,
} from 'react-native';
import VideoPlayer, {
  EQ_PRESETS,
  VideoPlayerHandle,
} from './VideoPlayer';
import { NativeNetwork } from './NativeNetwork';

const C = {
  bg: '#000000',
  surf: '#0A0A0E',
  surf2: '#12121A',
  line: 'rgba(255,255,255,0.14)',
  text: '#FFFFFF',
  textDim: '#CBD5E1',
  textMute: '#94A3B8',
  accent: '#06B6D4',
  accentGlow: 'rgba(6, 182, 212, 0.40)',
  amber: '#F59E0B',
  vlcOrange: '#FF6E00',
  vlcOrangeGlow: 'rgba(255, 110, 0, 0.45)',
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

  // Resize mode: In landscape default to 'zoom' (fill 100% of widescreen without black bars), in portrait 'fit'
  const [resizeMode, setResizeMode] = useState<'fit' | 'zoom' | 'fill'>(
    isLandscape ? 'zoom' : 'fit',
  );

  useEffect(() => {
    setResizeMode(isLandscape ? 'zoom' : 'fit');
  }, [isLandscape]);

  const [panel, setPanel] = useState<'none' | 'sound'>('none');
  const [eqPreset, setEqPreset] = useState('flat');
  const [showRemainingTime, setShowRemainingTime] = useState(true);

  // Orientation mode: 'portrait' | 'landscape' | 'auto'
  const [orientationMode, setOrientationMode] = useState<'portrait' | 'landscape' | 'auto'>('portrait');

  // VLC Gesture state: Volume & Brightness (0.0 to 1.0)
  const [volume, setVolume] = useState(0.85);
  const [brightness, setBrightness] = useState(0.85);
  const [activeHud, setActiveHud] = useState<'none' | 'volume' | 'brightness'>('none');

  const [livePos, setLivePos] = useState(0);
  const [liveDur, setLiveDur] = useState(0);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  draggingRef.current = dragging;

  const hideTimer = useRef<any>(null);
  const hudTimer = useRef<any>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // Refs for gesture tracking
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const brightnessRef = useRef(brightness);
  brightnessRef.current = brightness;
  const posRef = useRef(0);
  posRef.current = livePos > 0 ? livePos : p.position;
  const durRef = useRef(0);
  durRef.current = liveDur > 0 ? liveDur : p.duration;

  const lastTapRef = useRef<number>(0);
  const tapTimeoutRef = useRef<any>(null);

  const pos = livePos > 0 ? livePos : p.position;
  const dur = liveDur > 0 ? liveDur : p.duration;
  const remainingSec = Math.max(0, dur - pos);
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

  // Toggle controls on single tap
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

  // Relative seek (±10s) — fast and clean without huge screen-blocking popups
  const seekRelative = useCallback((delta: number) => {
    const target = Math.max(0, Math.min(dur || 1e9, pos + delta));
    setLivePos(target);
    playerRef.current?.seek(target);
    p.onSeek(Math.floor(target));
    showControls();
  }, [dur, pos, p, showControls]);

  // Toggle Auto-Rotate vs Manual Lock
  const toggleAutoRotate = useCallback(async () => {
    if (orientationMode === 'auto') {
      setOrientationMode('portrait');
      await NativeNetwork.setScreenOrientation('portrait');
    } else {
      setOrientationMode('auto');
      await NativeNetwork.setScreenOrientation('sensor');
    }
    showControls();
  }, [orientationMode, showControls]);

  // Force flip between Landscape and Portrait
  const toggleFlipOrientation = useCallback(async () => {
    const next = isLandscape ? 'portrait' : 'landscape';
    setOrientationMode(next);
    await NativeNetwork.setScreenOrientation(next);
    showControls();
  }, [isLandscape, showControls]);

  // Close player, restore system bars and enforce portrait orientation for the rest of the app
  const handleClose = useCallback(async () => {
    try {
      await NativeNetwork.setImmersiveFullscreen(false);
      await NativeNetwork.setScreenOrientation('portrait');
    } catch {}
    p.onClose();
  }, [p]);

  // Sync animation fade with chromeVisible
  useEffect(() => {
    Animated.timing(fade, {
      toValue: chromeVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [chromeVisible, fade]);

  // Enable Android Immersive Fullscreen and start strictly in Portrait mode (like VLC)
  useEffect(() => {
    if (p.visible) {
      NativeNetwork.setImmersiveFullscreen(true).catch(() => {});
      // Open video strictly in portrait mode initially — never glitch or auto-rotate without intent
      NativeNetwork.setScreenOrientation('portrait').catch(() => {});
      setOrientationMode('portrait');
      setChromeVisible(true);
      setPanel('none');
      setLivePos(0);
      setLiveDur(0);

      // Web: enter full screen
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const el: any = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
        if (req && !document.fullscreenElement) {
          try { req.call(el).catch?.(() => {}); } catch {}
        }
      }
    } else {
      NativeNetwork.setImmersiveFullscreen(false).catch(() => {});
      NativeNetwork.setScreenOrientation('portrait').catch(() => {});
    }
  }, [p.visible, p.uri]);

  // Cleanup on unmount — always lock back to portrait
  useEffect(() => {
    return () => {
      NativeNetwork.setImmersiveFullscreen(false).catch(() => {});
      NativeNetwork.setScreenOrientation('portrait').catch(() => {});
    };
  }, []);

  // Auto-hide controls management
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

  // ─── VLC Style PanResponder: Swipe Left = Volume, Swipe Right = Brightness ──
  const gestureStateRef = useRef<{
    mode: 'none' | 'volume' | 'brightness';
    startX: number;
    startY: number;
    initVol: number;
    initBri: number;
    hasMoved: boolean;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    initVol: 0.85,
    initBri: 0.85,
    hasMoved: false,
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => {
          return Math.abs(gesture.dy) > 10;
        },
        onPanResponderGrant: (evt) => {
          // Use pageX & pageY for true physical screen coordinates
          const pageX = evt.nativeEvent.pageX ?? evt.nativeEvent.locationX;
          const pageY = evt.nativeEvent.pageY ?? evt.nativeEvent.locationY;
          gestureStateRef.current = {
            mode: 'none',
            startX: pageX,
            startY: pageY,
            initVol: volumeRef.current,
            initBri: brightnessRef.current,
            hasMoved: false,
          };
          if (hudTimer.current) clearTimeout(hudTimer.current);
        },
        onPanResponderMove: (_, gesture) => {
          const gs = gestureStateRef.current;
          const { dy } = gesture;

          if (Math.abs(dy) > 10) {
            gs.hasMoved = true;
          }

          // Determine gesture type once threshold is crossed: Left half = Volume, Right half = Brightness
          if (gs.mode === 'none' && Math.abs(dy) > 12) {
            if (gs.startX < winWidth * 0.5) {
              gs.mode = 'volume'; // LEFT HALF -> VOLUME
            } else {
              gs.mode = 'brightness'; // RIGHT HALF -> BRIGHTNESS
            }
          }

          // Handle Volume Gesture (Left half vertical swipe)
          if (gs.mode === 'volume') {
            const delta = -dy / (winHeight * 0.55);
            const nextVol = Math.max(0, Math.min(1.0, gs.initVol + delta));
            setVolume(nextVol);
            NativeNetwork.setDeviceVolume(nextVol).catch(() => {});
            setActiveHud('volume');
          }

          // Handle Brightness Gesture (Right half vertical swipe)
          else if (gs.mode === 'brightness') {
            const delta = -dy / (winHeight * 0.55);
            const nextBri = Math.max(0.05, Math.min(1.0, gs.initBri + delta));
            setBrightness(nextBri);
            NativeNetwork.setScreenBrightness(nextBri).catch(() => {});
            setActiveHud('brightness');
          }
        },
        onPanResponderRelease: (evt) => {
          const gs = gestureStateRef.current;

          // Fade out volume or brightness HUD after 800ms
          if (gs.mode === 'volume' || gs.mode === 'brightness') {
            hudTimer.current = setTimeout(() => setActiveHud('none'), 800);
            return;
          }

          // If no movement -> this is a TAP or DOUBLE TAP
          if (!gs.hasMoved) {
            const x = evt.nativeEvent.pageX ?? evt.nativeEvent.locationX;
            const now = Date.now();
            const timeDelta = now - lastTapRef.current;
            lastTapRef.current = now;

            if (timeDelta < 300) {
              // Double tap detected!
              if (tapTimeoutRef.current) {
                clearTimeout(tapTimeoutRef.current);
                tapTimeoutRef.current = null;
              }
              if (x < winWidth * 0.38) {
                seekRelative(-10);
              } else if (x > winWidth * 0.62) {
                seekRelative(10);
              } else {
                p.onTogglePlay();
                showControls();
              }
            } else {
              // Single tap candidate -> toggle controls
              tapTimeoutRef.current = setTimeout(() => {
                toggleControls();
              }, 260);
            }
          }
        },
      }),
    [winWidth, winHeight, p, seekRelative, showControls, toggleControls],
  );

  // Cycle aspect ratio
  const cycleResizeMode = () => {
    setResizeMode(curr => {
      if (curr === 'zoom') return 'fit';
      if (curr === 'fit') return 'fill';
      return 'zoom';
    });
    showControls();
  };

  const resizeModeLabel =
    resizeMode === 'zoom' ? '🔳 Fill Screen' : resizeMode === 'fit' ? '🔲 Original (Fit)' : '↔️ Stretch';

  if (!p.visible) return null;

  return (
    <View style={styles.root}>
      {/* Auto-hide Status Bar for edge-to-edge cinematic view */}
      <StatusBar
        hidden={!chromeVisible}
        translucent
        backgroundColor="transparent"
        barStyle="light-content"
      />

      {/* ── 1. Video Canvas (100% full screen) ─────────────────────────────── */}
      <View style={StyleSheet.absoluteFill}>
        <VideoPlayer
          handleRef={playerRef}
          uri={p.uri}
          audioUri={p.audioUri}
          isPlaying={p.isPlaying}
          brightness={brightness}
          volume={volume}
          muted={false}
          eqPreset={eqPreset}
          resizeMode={resizeMode}
          onDuration={d => setLiveDur(d)}
          onProgress={(t, d) => {
            if (!draggingRef.current) setLivePos(t);
            if (d > 0 && Math.abs(d - liveDur) > 0.25) setLiveDur(d);
          }}
          onEnded={() => {
            setChromeVisible(true);
            p.onEnded?.();
          }}
        />
      </View>

      {/* ── 2. Real-time Software Brightness Tint Overlay (Guarantees visual dimming) ── */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: '#000000',
            opacity: Math.max(0, Math.min(0.80, (1 - brightness) * 0.75)),
            zIndex: 4,
          },
        ]}
      />

      {/* ── 3. Full-surface VLC Gesture Capture Layer ───────────────────────── */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        {/* Left Side: Volume HUD on the edge */}
        {activeHud === 'volume' && (
          <View style={styles.leftVolumeHud} pointerEvents="none">
            <Text style={styles.hudIcon}>{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</Text>
            <View style={styles.hudVerticalTrack}>
              <View style={[styles.hudVerticalFill, { height: `${Math.round(volume * 100)}%` }]} />
            </View>
            <Text style={styles.hudValueText}>{Math.round(volume * 100)}%</Text>
          </View>
        )}

        {/* Right Side: Brightness HUD on the edge */}
        {activeHud === 'brightness' && (
          <View style={styles.rightBrightnessHud} pointerEvents="none">
            <Text style={styles.hudIcon}>☀️</Text>
            <View style={styles.hudVerticalTrack}>
              <View
                style={[
                  styles.hudVerticalFill,
                  { height: `${Math.round(brightness * 100)}%`, backgroundColor: C.amber },
                ]}
              />
            </View>
            <Text style={[styles.hudValueText, { color: C.amber }]}>{Math.round(brightness * 100)}%</Text>
          </View>
        )}
      </View>

      {/* ── 4. Floating Overlay Controls (VLC / MX Player Style) ─────────────── */}
      {chromeVisible && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: fade, zIndex: 20 }]}
          pointerEvents="box-none">

          {/* ── Top Bar: Back Button & Centered Title (matches screenshot) ── */}
          <View
            style={[
              styles.topBar,
              {
                paddingTop: isLandscape ? 14 : (Platform.OS === 'android' ? 36 : 46),
                paddingHorizontal: isLandscape ? 24 : 16,
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

            {/* Quick Auto-Rotate toggle indicator in top right */}
            <TouchableOpacity
              style={[
                styles.topBadgeBtn,
                orientationMode === 'auto' && styles.topBadgeBtnActive,
              ]}
              onPress={toggleAutoRotate}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.topBadgeText}>
                {orientationMode === 'auto' ? '📱🔄 Auto' : isLandscape ? '🔄 Land' : '📱 Port'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sound / Equalizer Drawer (when opened via •••) */}
          {panel === 'sound' && (
            <View
              style={[
                styles.soundDrawer,
                {
                  left: isLandscape ? '25%' : 16,
                  right: isLandscape ? '25%' : 16,
                  bottom: isLandscape ? 85 : 120,
                },
              ]}>
              <View style={styles.drawerHeader}>
                <Text style={styles.drawerTitle}>Sound & Audio FX</Text>
                <TouchableOpacity onPress={() => setPanel('none')}>
                  <Text style={styles.drawerClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.drawerRow}>
                <Text style={styles.drawerLabel}>Volume: {Math.round(volume * 100)}%</Text>
                <TouchableOpacity onPress={() => setVolume(v => (v > 0 ? 0 : 0.85))}>
                  <Text style={styles.muteBtnText}>{volume === 0 ? '🔇 Unmute' : '🔊 Mute'}</Text>
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

          {/* ── Bottom Section: Scrubber + VLC Control Buttons ── */}
          <View
            style={[
              styles.bottomBar,
              {
                paddingBottom: isLandscape ? 14 : (Platform.OS === 'android' ? 24 : 32),
                paddingHorizontal: isLandscape ? 28 : 16,
              },
            ]}>
            {/* Scrubber row: Elapsed (0:06) ── [Slider with Orange Knob] ── Remaining (- 2:27:25) */}
            <View style={styles.scrubberRow}>
              <Text style={styles.timeLabel}>{fmt(pos)}</Text>

              <View style={styles.sliderFlex}>
                <Slider
                  value={pct}
                  min={0}
                  max={1}
                  onStart={() => {
                    draggingRef.current = true;
                    setDragging(true);
                    clearHideTimer();
                  }}
                  onChange={v => {
                    setLivePos(v * dur);
                  }}
                  onEnd={finalVal => {
                    const target = Math.max(0, Math.min(dur, finalVal * dur));
                    setLivePos(target);
                    playerRef.current?.seek(target);
                    p.onSeek(Math.floor(target));
                    setTimeout(() => {
                      draggingRef.current = false;
                      setDragging(false);
                    }, 250);
                    showControls();
                  }}
                />
              </View>

              <TouchableOpacity
                onPress={() => setShowRemainingTime(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.timeLabel}>
                  {showRemainingTime ? `- ${fmt(remainingSec)}` : fmt(dur)}
                </Text>
              </TouchableOpacity>
            </View>

            {/* VLC 5-Icon Controls Bar (matches media_1793899235471_98a35099.jpg) */}
            <View style={styles.vlcIconsRow}>
              {/* 1. Subtitle / Aspect Mode Button */}
              <TouchableOpacity
                style={styles.vlcIconBtn}
                onPress={cycleResizeMode}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}>
                <Text style={styles.vlcIconEmoji}>
                  {resizeMode === 'zoom' ? '🔳' : resizeMode === 'fill' ? '↔️' : '🔲'}
                </Text>
                <Text style={styles.vlcIconSub}>{resizeModeLabel}</Text>
              </TouchableOpacity>

              {/* 2. Auto-Rotate / Lock Button */}
              <TouchableOpacity
                style={[
                  styles.vlcIconBtn,
                  orientationMode === 'auto' && styles.vlcIconBtnActive,
                ]}
                onPress={toggleAutoRotate}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}>
                <Text style={styles.vlcIconEmoji}>
                  {orientationMode === 'auto' ? '📱🔄' : '🔒'}
                </Text>
                <Text style={[styles.vlcIconSub, orientationMode === 'auto' && { color: C.accent }]}>
                  {orientationMode === 'auto' ? 'Auto' : 'Locked'}
                </Text>
              </TouchableOpacity>

              {/* 3. CENTER: Large Circular Play / Pause Button (like VLC) */}
              <TouchableOpacity
                style={styles.vlcCenterPlayBtn}
                onPress={() => {
                  p.onTogglePlay();
                  showControls();
                }}
                activeOpacity={0.85}
                hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
                <Text style={styles.vlcCenterPlayIcon}>
                  {p.isPlaying ? '⏸' : '▶'}
                </Text>
              </TouchableOpacity>

              {/* 4. Fullscreen / Landscape Flip Button */}
              <TouchableOpacity
                style={styles.vlcIconBtn}
                onPress={toggleFlipOrientation}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}>
                <Text style={styles.vlcIconEmoji}>⛶</Text>
                <Text style={styles.vlcIconSub}>
                  {isLandscape ? 'Portrait' : 'Landscape'}
                </Text>
              </TouchableOpacity>

              {/* 5. More Options Button (Sound FX / EQ) */}
              <TouchableOpacity
                style={[
                  styles.vlcIconBtn,
                  panel === 'sound' && styles.vlcIconBtnActive,
                ]}
                onPress={() => {
                  setPanel(curr => (curr === 'sound' ? 'none' : 'sound'));
                  showControls();
                }}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}>
                <Text style={styles.vlcIconEmoji}>•••</Text>
                <Text style={styles.vlcIconSub}>Sound</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

/**
 * High-performance, cross-platform touch scrubber built with PanResponder.
 * Features an orange circular knob matching VLC player in user screenshot.
 * Protected against jump-to-0 bugs via pointerEvents="none" and delta dragging.
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
  onEnd?: (finalValue: number) => void;
}) {
  const widthRef = useRef(0);
  const range = max - min || 1;
  const norm = Math.max(0, Math.min(1, (value - min) / range));
  const startFrac = useRef(0);
  const currentFrac = useRef(norm);
  currentFrac.current = norm;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e: any) => {
          onStart?.();
          const w = widthRef.current || 1;
          const touchX = Math.max(0, Math.min(w, e.nativeEvent.locationX));
          const f = w > 0 ? touchX / w : 0;
          startFrac.current = f;
          currentFrac.current = f;
          onChange(min + f * range);
        },
        onPanResponderMove: (_: any, g: any) => {
          const w = widthRef.current || 1;
          const f = Math.max(0, Math.min(1, startFrac.current + g.dx / w));
          currentFrac.current = f;
          onChange(min + f * range);
        },
        onPanResponderRelease: () => {
          onEnd?.(currentFrac.current);
        },
        onPanResponderTerminate: () => {
          onEnd?.(currentFrac.current);
        },
      }),
    [min, range, onChange, onStart, onEnd],
  );

  return (
    <View
      style={styles.sliderHitBox}
      onLayout={e => {
        widthRef.current = e.nativeEvent.layout.width;
      }}
      {...responder.panHandlers}>
      <View style={styles.sliderRail} pointerEvents="none" />
      <View style={[styles.sliderFill, { width: `${norm * 100}%` }]} pointerEvents="none" />
      <View style={[styles.sliderThumb, { left: `${norm * 100}%` }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    overflow: 'hidden',
    zIndex: 99999,
    elevation: 99999,
  },

  // ── Top Bar (Clean, centered title matching VLC) ───────────────────────────
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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
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
    marginHorizontal: 14,
    alignItems: 'center',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  subtitleText: {
    color: C.textMute,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
  },
  topBadgeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  topBadgeBtnActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.22)',
    borderColor: C.accent,
  },
  topBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },

  // ── VLC Edge HUDs (Left = Volume, Right = Brightness) ─────────────────────
  leftVolumeHud: {
    position: 'absolute',
    left: 20,
    top: '30%',
    bottom: '30%',
    width: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    paddingVertical: 12,
    zIndex: 35,
  },
  rightBrightnessHud: {
    position: 'absolute',
    right: 20,
    top: '30%',
    bottom: '30%',
    width: 44,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: C.amber,
    alignItems: 'center',
    paddingVertical: 12,
    zIndex: 35,
  },
  hudIcon: {
    fontSize: 18,
    marginBottom: 8,
  },
  hudVerticalTrack: {
    flex: 1,
    width: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  hudVerticalFill: {
    width: '100%',
    backgroundColor: C.accent,
    borderRadius: 3,
  },
  hudValueText: {
    color: C.accent,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 8,
  },

  // ── Bottom Section (VLC Style) ─────────────────────────────────────────────
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingTop: 12,
    zIndex: 20,
  },
  scrubberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sliderFlex: {
    flex: 1,
    marginHorizontal: 12,
  },
  timeLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 54,
    textAlign: 'center',
  },

  // ── VLC 5-Icon Controls Bar ────────────────────────────────────────────────
  vlcIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginTop: 2,
  },
  vlcIconBtn: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
  },
  vlcIconBtnActive: {
    backgroundColor: 'rgba(6, 182, 212, 0.16)',
  },
  vlcIconEmoji: {
    fontSize: 22,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  vlcIconSub: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    textAlign: 'center',
  },

  // Big VLC Center Play/Pause Button
  vlcCenterPlayBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vlcCenterPlayIcon: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 28,
  },

  // ── Slider with Orange Knob (matching VLC reference) ──────────────────────
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
    backgroundColor: C.vlcOrange,
    top: 16,
    left: 0,
  },
  sliderThumb: {
    position: 'absolute',
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.vlcOrange,
    marginLeft: -8,
    shadowColor: C.vlcOrange,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 4,
  },

  // ── Sound Drawer ───────────────────────────────────────────────────────────
  soundDrawer: {
    position: 'absolute',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    padding: 18,
    zIndex: 25,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  drawerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  drawerClose: {
    color: C.textMute,
    fontSize: 18,
    fontWeight: '700',
    padding: 4,
  },
  drawerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  drawerLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  muteBtnText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  drawerSectionLabel: {
    color: C.textMute,
    fontSize: 11,
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
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    fontSize: 12,
    fontWeight: '600',
  },
  eqChipTextActive: {
    color: C.accent,
  },
});
