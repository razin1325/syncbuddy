/**
 * FullscreenPlayer — True VLC / MX Player Style Edge-to-Edge Experience
 *
 * Professional Media Player Capabilities:
 *   • True 100% Immersive Fullscreen (Hides system status bar & navigation pill via IMMERSIVE_STICKY)
 *   • Auto-Rotate Support (Phone sensor dynamically flips between Portrait and Landscape)
 *   • Portrait Layout matches VLC Mobile:
 *       - Clean pure black canvas (#000000)
 *       - Centered video in natural aspect ratio (RESIZE_MODE_FIT)
 *       - Top centered title
 *       - Bottom scrubber with elapsed (0:06) & remaining (- 2:27:25) time
 *       - Bottom icon row: [🔲 Aspect] [📱🔄 Auto-Rotate] ( ⏸ / ▶ ) [⛶ Fullscreen] [••• More]
 *   • VLC-style Gestures:
 *       - Swipe UP/DOWN on RIGHT half: Controls Screen Brightness (0% to 100%) with real-time HUD
 *       - Swipe UP/DOWN on LEFT half: Controls Media Volume (0% to 100%) with real-time HUD
 *       - Swipe LEFT/RIGHT anywhere: Fast-seeks through video with time preview HUD
 *   • Single Tap on screen: Toggles controls overlay (Tap -> Show, Tap again -> Hide)
 *   • Double Tap Left/Right: Fast ±10s seeking with visual indicator
 *   • Auto-hide controls after 3.5s of inactivity while playing
 *   • Aspect Ratio Modes:
 *       - 🔲 Fit: Original video aspect ratio (no cropping, centered)
 *       - 🔳 Zoom (Fill Screen): Fills 100% of display without letterbox black bars
 *       - ↔️ Stretch: 100% stretch
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

  // Resize mode: In portrait, default to 'fit' (original centered ratio); in landscape, 'zoom' (fill screen)
  const [resizeMode, setResizeMode] = useState<'fit' | 'zoom' | 'fill'>('fit');
  const [panel, setPanel] = useState<'none' | 'sound'>('none');
  const [eqPreset, setEqPreset] = useState('flat');
  const [showRemainingTime, setShowRemainingTime] = useState(true);

  // Orientation mode: 'auto' (phone sensor), 'landscape', 'portrait'
  const [orientationMode, setOrientationMode] = useState<'auto' | 'landscape' | 'portrait'>('auto');

  // VLC Gesture state
  const [volume, setVolume] = useState(0.85);
  const [brightness, setBrightness] = useState(0.85);
  const [activeHud, setActiveHud] = useState<'none' | 'volume' | 'brightness' | 'seek'>('none');
  const [seekPreviewSec, setSeekPreviewSec] = useState<number>(0);
  const [seekDeltaSec, setSeekDeltaSec] = useState<number>(0);

  // Quick feedback badge (e.g. "+10s" / "📱🔄 Auto-Rotate ON")
  const [quickBadge, setQuickBadge] = useState<{ text: string; side: 'left' | 'right' | 'center' } | null>(null);

  const [livePos, setLivePos] = useState(0);
  const [liveDur, setLiveDur] = useState(0);
  const [dragging, setDragging] = useState(false);

  const hideTimer = useRef<any>(null);
  const hudTimer = useRef<any>(null);
  const badgeTimer = useRef<any>(null);
  const fade = useRef(new Animated.Value(1)).current;

  // Refs for gesture gestureState tracking
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

  // Visual badge popup
  const showQuickBadge = useCallback((text: string, side: 'left' | 'right' | 'center') => {
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    setQuickBadge({ text, side });
    badgeTimer.current = setTimeout(() => {
      setQuickBadge(null);
    }, 1100);
  }, []);

  // Relative seek (±10s)
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
      // Lock to current orientation
      const current = isLandscape ? 'landscape' : 'portrait';
      setOrientationMode(current);
      await NativeNetwork.setScreenOrientation(current);
      showQuickBadge(isLandscape ? '🔒 Landscape Locked' : '🔒 Portrait Locked', 'center');
    } else {
      // Re-enable phone sensor auto-rotation
      setOrientationMode('auto');
      await NativeNetwork.setScreenOrientation('auto');
      showQuickBadge('📱🔄 Auto-Rotate ON (Phone Sensor)', 'center');
    }
    showControls();
  }, [orientationMode, isLandscape, showQuickBadge, showControls]);

  // Force flip between Landscape and Portrait
  const toggleFlipOrientation = useCallback(async () => {
    const next = isLandscape ? 'portrait' : 'landscape';
    setOrientationMode(next);
    await NativeNetwork.setScreenOrientation(next);
    showQuickBadge(next === 'landscape' ? '🔄 Landscape Mode' : '📱 Portrait Mode', 'center');
    showControls();
  }, [isLandscape, showQuickBadge, showControls]);

  // Close player, restore system bars and enforce portrait orientation
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
      duration: 200,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [chromeVisible, fade]);

  // Enable Android Immersive Fullscreen and start strictly in Portrait mode (like VLC)
  useEffect(() => {
    if (p.visible) {
      NativeNetwork.setImmersiveFullscreen(true).catch(() => {});
      // Open video strictly in portrait mode — no accidental rotation
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

  // ─── VLC Style PanResponder Gesture Engine ─────────────────────────────────
  const gestureStateRef = useRef<{
    mode: 'none' | 'volume' | 'brightness' | 'seek';
    startX: number;
    startY: number;
    initVol: number;
    initBri: number;
    initPos: number;
    hasMoved: boolean;
  }>({
    mode: 'none',
    startX: 0,
    startY: 0,
    initVol: 0.85,
    initBri: 0.85,
    initPos: 0,
    hasMoved: false,
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => {
          return Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10;
        },
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          gestureStateRef.current = {
            mode: 'none',
            startX: locationX,
            startY: locationY,
            initVol: volumeRef.current,
            initBri: brightnessRef.current,
            initPos: posRef.current,
            hasMoved: false,
          };
          if (hudTimer.current) clearTimeout(hudTimer.current);
        },
        onPanResponderMove: (_, gesture) => {
          const gs = gestureStateRef.current;
          const { dx, dy } = gesture;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > 12) {
            gs.hasMoved = true;
          }

          // Determine gesture type once threshold is crossed
          if (gs.mode === 'none' && distance > 14) {
            if (Math.abs(dy) > Math.abs(dx)) {
              // Vertical swipe
              if (gs.startX < winWidth * 0.5) {
                gs.mode = 'volume'; // LEFT SIDE -> VOLUME
              } else {
                gs.mode = 'brightness'; // RIGHT SIDE -> BRIGHTNESS
              }
            } else if (Math.abs(dx) > 20) {
              gs.mode = 'seek'; // HORIZONTAL SWIPE -> SEEK
            }
          }

          // Handle Volume Gesture (Left half vertical swipe)
          if (gs.mode === 'volume') {
            const delta = -dy / (winHeight * 0.65);
            const nextVol = Math.max(0, Math.min(1.0, gs.initVol + delta));
            setVolume(nextVol);
            NativeNetwork.setDeviceVolume(nextVol).catch(() => {});
            setActiveHud('volume');
          }

          // Handle Brightness Gesture (Right half vertical swipe)
          else if (gs.mode === 'brightness') {
            const delta = -dy / (winHeight * 0.65);
            const nextBri = Math.max(0.02, Math.min(1.0, gs.initBri + delta));
            setBrightness(nextBri);
            NativeNetwork.setScreenBrightness(nextBri).catch(() => {});
            setActiveHud('brightness');
          }

          // Handle Horizontal Seek Gesture
          else if (gs.mode === 'seek') {
            const totalDuration = durRef.current || 1e9;
            const deltaSec = (dx / (winWidth * 0.8)) * 90; // swipe across screen moves 90s
            const target = Math.max(0, Math.min(totalDuration, gs.initPos + deltaSec));
            setSeekPreviewSec(target);
            setSeekDeltaSec(deltaSec);
            setActiveHud('seek');
          }
        },
        onPanResponderRelease: (evt) => {
          const gs = gestureStateRef.current;

          // If it was a swipe seek: commit the seek position now
          if (gs.mode === 'seek') {
            setLivePos(seekPreviewSec);
            playerRef.current?.seek(seekPreviewSec);
            p.onSeek(Math.floor(seekPreviewSec));
            hudTimer.current = setTimeout(() => setActiveHud('none'), 600);
            return;
          }

          // Fade out volume or brightness HUD after 900ms
          if (gs.mode === 'volume' || gs.mode === 'brightness') {
            hudTimer.current = setTimeout(() => setActiveHud('none'), 900);
            return;
          }

          // If no movement -> this is a TAP or DOUBLE TAP
          if (!gs.hasMoved) {
            const x = evt.nativeEvent.locationX;
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
                showQuickBadge('-10s ⏪', 'left');
              } else if (x > winWidth * 0.62) {
                seekRelative(10);
                showQuickBadge('⏩ +10s', 'right');
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
    [winWidth, winHeight, seekPreviewSec, p, seekRelative, showQuickBadge, showControls, toggleControls],
  );

  // Cycle aspect ratio
  const cycleResizeMode = () => {
    setResizeMode(curr => {
      const next = curr === 'fit' ? 'zoom' : curr === 'zoom' ? 'fill' : 'fit';
      const label = next === 'fit' ? '🔲 Original (Fit)' : next === 'zoom' ? '🔳 Fill Screen' : '↔️ Stretch';
      showQuickBadge(label, 'center');
      return next;
    });
    showControls();
  };

  const resizeModeLabel =
    resizeMode === 'zoom' ? '🔳 Fill' : resizeMode === 'fit' ? '🔲 Fit' : '↔️ Stretch';

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
            if (!dragging) setLivePos(t);
            if (d > 0 && Math.abs(d - liveDur) > 0.25) setLiveDur(d);
          }}
          onEnded={() => {
            setChromeVisible(true);
            p.onEnded?.();
          }}
        />
      </View>

      {/* ── 2. Full-surface VLC Gesture Capture Layer ───────────────────────── */}
      <View style={StyleSheet.absoluteFill} {...panResponder.panHandlers}>
        {/* Quick feedback badge (e.g. "+10s" / "📱🔄 Auto-Rotate ON") */}
        {quickBadge && (
          <View
            style={[
              styles.quickBadgeBox,
              quickBadge.side === 'left'
                ? styles.quickBadgeLeft
                : quickBadge.side === 'right'
                ? styles.quickBadgeRight
                : styles.quickBadgeCenter,
            ]}>
            <Text style={styles.quickBadgeText}>{quickBadge.text}</Text>
          </View>
        )}

        {/* ── 3. VLC-style Visual HUDs ───────────────────────────────────────── */}

        {/* Left Side: Volume HUD */}
        {activeHud === 'volume' && (
          <View style={styles.leftVolumeHud}>
            <Text style={styles.hudIcon}>{volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}</Text>
            <View style={styles.hudVerticalTrack}>
              <View style={[styles.hudVerticalFill, { height: `${Math.round(volume * 100)}%` }]} />
            </View>
            <Text style={styles.hudValueText}>{Math.round(volume * 100)}%</Text>
          </View>
        )}

        {/* Right Side: Brightness HUD */}
        {activeHud === 'brightness' && (
          <View style={styles.rightBrightnessHud}>
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

        {/* Center: Horizontal Seek Preview HUD */}
        {activeHud === 'seek' && (
          <View style={styles.centerSeekHud}>
            <Text style={styles.seekHudDelta}>
              {seekDeltaSec >= 0 ? `+${Math.round(seekDeltaSec)}s ⏩` : `${Math.round(seekDeltaSec)}s ⏪`}
            </Text>
            <Text style={styles.seekHudTime}>
              {fmt(seekPreviewSec)} <Text style={{ color: C.textMute }}>/ {fmt(dur)}</Text>
            </Text>
          </View>
        )}
      </View>

      {/* ── 4. Floating Overlay Controls (VLC / MX Player Style) ─────────────── */}
      {chromeVisible && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: fade }]}
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

            {/* Quick Auto-Rotate status badge indicator in top right */}
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
                  left: isLandscape ? '20%' : 16,
                  right: isLandscape ? '20%' : 16,
                  bottom: isLandscape ? 90 : 120,
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

  // ── VLC Gesture Visual HUDs ────────────────────────────────────────────────
  leftVolumeHud: {
    position: 'absolute',
    left: 28,
    top: '28%',
    bottom: '28%',
    width: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    paddingVertical: 12,
    zIndex: 35,
  },
  rightBrightnessHud: {
    position: 'absolute',
    right: 28,
    top: '28%',
    bottom: '28%',
    width: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: C.amber,
    alignItems: 'center',
    paddingVertical: 12,
    zIndex: 35,
  },
  hudIcon: {
    fontSize: 20,
    marginBottom: 8,
  },
  hudVerticalTrack: {
    flex: 1,
    width: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  hudVerticalFill: {
    width: '100%',
    backgroundColor: C.accent,
    borderRadius: 4,
  },
  hudValueText: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 8,
  },

  // Center Seek HUD
  centerSeekHud: {
    position: 'absolute',
    top: '40%',
    left: '25%',
    right: '25%',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 35,
  },
  seekHudDelta: {
    color: C.accent,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  seekHudTime: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Quick Double-tap / Orientation Badge
  quickBadgeBox: {
    position: 'absolute',
    top: '38%',
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 30,
  },
  quickBadgeLeft: {
    left: '12%',
  },
  quickBadgeRight: {
    right: '12%',
  },
  quickBadgeCenter: {
    left: '20%',
    right: '20%',
  },
  quickBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
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
