/**
 * SyncBuddy — Futuristic Offline Audio Sync & Walkie-Talkie Suite
 *
 * Real Offline LAN Peer-to-Peer System (Zero Internet Needed):
 *   ├── Page 1: 📡 Host Room (Local HTTP/TCP Server, ISO QR Code, Live Participants Sync)
 *   ├── Page 2: 🎧 Join Room (LAN Auto-Discovery, One-Tap Join, Real-Time Audio Sync)
 *   ├── Page 3: 📻 Walkie-Talkie (Real-time PTT Voice & Channel Relay)
 *   └── Page 4: 📱 Devices (BLE Hardware Manager, On-Demand 10s Scan, Real Battery)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
  ActivityIndicator,
  Platform,
  Modal,
  Animated,
  Image,
  PanResponder,
  PermissionsAndroid,
  useWindowDimensions,
} from 'react-native';
import VideoPlayer, { EQ_PRESETS, FX_PRESETS } from './VideoPlayer';
import FullscreenPlayer from './FullscreenPlayer';
import {
  NativeBluetooth,
  NativeAuracast,
  createBluetoothStateEmitter,
  BT_EVENTS,
} from './NativeBluetooth';
import {
  NativeNetwork,
  NetworkInfo,
  Participant,
  DiscoveredRoom,
  ListenerJoinedEvent,
  ListenerLeftEvent,
  PttMessageEvent,
  DeviceMediaItem,
  PlaybackState,
} from './NativeNetwork';
import { generateQRMatrix } from './QRCodeGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavigationPage = 'host' | 'join' | 'media' | 'walkie' | 'devices';
export type DeviceType = 'Audio' | 'Wearable' | 'Computer' | 'IoT Sensor' | 'Peripheral';
export type DeviceStatus = 'Broadcasting' | 'Connected' | 'Connecting' | 'Paired' | 'Available';
export type FilterTab = 'All' | 'Connected' | 'Paired' | 'Audio' | 'Wearables';
export type AudioSource = 'mic' | 'music' | 'lecture' | 'ambient' | 'synth' | 'file';

export interface BluetoothDevice {
  id: string;
  name: string;
  type: DeviceType;
  rssi: number;
  battery?: number;
  status: DeviceStatus;
  macAddress: string;
  leAudioSupport: boolean;
  isSelected: boolean;
  volume: number;
  rawDevice?: any;
}

export interface AudioTrack {
  id: string;
  title: string;
  artist: string;
  duration: string;
  source: AudioSource;
}

const AUDIO_TRACKS: AudioTrack[] = [
  { id: 't0', title: 'Cyber Sync Beat (Auto Melody)', artist: 'Test track • Plays a built-in melody, no file needed', duration: 'Loop', source: 'synth' },
  { id: 't1', title: 'Local Audio File (downloaded music)', artist: 'Pick any MP3 or song from your storage', duration: 'File', source: 'file' },
  { id: 't2', title: 'Live Mic Pass-through', artist: 'Talk or play sound through the phone mic', duration: 'Live', source: 'mic' },
  { id: 't3', title: 'System Audio Loopback (Spotify / YouTube)', artist: 'Background sound from other apps', duration: 'Live', source: 'music' },
];

function detectDeviceType(name: string): DeviceType {
  const n = (name || '').toLowerCase();
  if (
    n.includes('bud') ||
    n.includes('headphone') ||
    n.includes('ear') ||
    n.includes('audio') ||
    n.includes('jbl') ||
    n.includes('airpod') ||
    n.includes('sound') ||
    n.includes('flip') ||
    n.includes('sony') ||
    n.includes('bose') ||
    n.includes('tune') ||
    n.includes('boat') ||
    n.includes('redmi') ||
    n.includes('pro')
  ) {
    return 'Audio';
  }
  if (n.includes('band') || n.includes('watch') || n.includes('fit') || n.includes('ring')) {
    return 'Wearable';
  }
  if (n.includes('pc') || n.includes('mac') || n.includes('laptop') || n.includes('windows')) {
    return 'Computer';
  }
  return 'Peripheral';
}

function getSignalInfo(rssi: number) {
  if (rssi >= -50) return { label: 'Excellent', color: '#34D399', dots: '••••' };
  if (rssi >= -65) return { label: 'Good', color: '#22D3EE', dots: '•••○' };
  if (rssi >= -78) return { label: 'Fair', color: '#FBBF24', dots: '••○○' };
  return { label: 'Weak', color: '#F87171', dots: '•○○○' };
}

// ─── Real Scannable ISO QR Code Matrix Component ─────────────────────────────
// Generates a true ISO/IEC 18004 QR bitmap using standard pure TypeScript engine.
// Readable by any camera, Google Lens, or barcode scanner!

const RealQRMatrix: React.FC<{ value: string; size?: number }> = ({ value, size = 200 }) => {
  const matrix = React.useMemo(() => {
    try {
      return generateQRMatrix(value);
    } catch {
      return [];
    }
  }, [value]);

  if (!matrix.length) {
    return (
      <View style={[qrS.box, { width: size + 20, height: size + 20 }]}>
        <ActivityIndicator color="#06B6D4" />
      </View>
    );
  }

  const count = matrix.length;
  // Use integer module sizing to prevent any subpixel seams or gaps!
  const cellSize = Math.max(3, Math.floor(size / count));
  const actualSize = cellSize * count;

  return (
    <View style={[qrS.box, { width: actualSize + 20, height: actualSize + 20 }]}>
      <View style={{ width: actualSize, height: actualSize, backgroundColor: '#FFFFFF' }}>
        {matrix.map((row, rIdx) => (
          <View key={rIdx} style={{ flexDirection: 'row', height: cellSize }}>
            {row.map((cell, cIdx) => (
              <View
                key={cIdx}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: cell ? '#000000' : '#FFFFFF',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
};

const qrS = StyleSheet.create({
  box: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#22D3EE',
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
});

// ─── Media Library: helpers ──────────────────────────────────────────────────

/**
 * Containers the bundled Media3 extractors cannot demux. They are still listed
 * (so nothing on the phone is hidden) but are handed to an installed player
 * instead of failing silently inside the app.
 */
const EXTERNAL_ONLY_VIDEO = [
  'AVI', 'WMV', 'ASF', 'FLV', 'F4V', 'MPG', 'MPEG', 'M2TS', 'TS', 'TSV',
  'RM', 'RMVB', 'VOB', 'OGV', 'DIVX', '3G2',
];
const EXTERNAL_ONLY_AUDIO = [
  'APE', 'WV', 'MPC', 'AIFF', 'AIF', 'DSF', 'DFF', 'WMA', 'TAK', 'TTA',
];

function needsExternalPlayer(item: DeviceMediaItem): boolean {
  const fmt = (item.format || '').toUpperCase();
  const list = item.type === 'video' ? EXTERNAL_ONLY_VIDEO : EXTERNAL_ONLY_AUDIO;
  return list.indexOf(fmt) >= 0;
}

/**
 * In the browser there is no MediaStore, so the demo list uses placeholder
 * `web-demo://` URIs. Map those to the real bundled clip we generate offline
 * (see tools/make-demo-video.js) so video actually plays and can be scrubbed.
 *
 * These live in /public and are served from the site root. A Metro `require()`
 * would return a numeric asset id rather than a usable URL in the web export,
 * which left <video> pointing at "http://host/1" and therefore at nothing.
 * Android always keeps the genuine content:// URI.
 */
const DEMO_VIDEO_URL = 'demo-video.webm';
const DEMO_AUDIO_URL = 'demo-tone.wav';

function webMediaUri(uri: string): string {
  if (Platform.OS !== 'web') return uri;
  if (uri.indexOf('web-demo://') === 0) return DEMO_VIDEO_URL;
  return uri;
}

/**
 * The recorded demo clip is video-only because headless Chrome cannot mux an
 * audio track. Attach a generated WAV so volume / EQ / effects are audible.
 * Real device files return undefined and use their own audio stream.
 */
function webMediaAudio(uri: string): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  if (uri.indexOf('web-demo://') === 0) return DEMO_AUDIO_URL;
  return undefined;
}

/** 3:07 or 1:02:44 — input is milliseconds. */
function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0 || !isFinite(ms)) return '--:--';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function mediaDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((today - that) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface MediaGroup {
  key: string;
  label: string;
  items: DeviceMediaItem[];
}

function groupMediaByDate(items: DeviceMediaItem[]): MediaGroup[] {
  const groups: MediaGroup[] = [];
  items.forEach(item => {
    const ts = item.dateAdded || 0;
    const key = ts > 0 ? new Date(ts).toDateString() : 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, label: ts > 0 ? mediaDayLabel(ts) : 'Older files', items: [item] });
    }
  });
  return groups;
}

// ─── Media Library: components ───────────────────────────────────────────────

/** Album art / video poster with a graceful icon fallback. */
const MediaArt: React.FC<{
  uri?: string;
  type: 'audio' | 'video';
  size?: number;
  radius?: number;
}> = ({ uri, type, size = 50, radius = 12 }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#101017' }}
        onError={() => setFailed(true)}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: type === 'video' ? '#2E1065' : '#0E7490',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ fontSize: Math.round(size * 0.4) }}>{type === 'video' ? '🎬' : '🎵'}</Text>
    </View>
  );
};

/** One library row: art, title, meta, format badge, duration, play state. */
const MediaRow: React.FC<{
  item: DeviceMediaItem;
  active: boolean;
  playing: boolean;
  onPress: () => void;
}> = ({ item, active, playing, onPress }) => {
  const external = needsExternalPlayer(item);
  return (
    <TouchableOpacity
      style={[styles.mediaRow, active && styles.mediaRowActive]}
      onPress={onPress}
      activeOpacity={0.75}>
      <MediaArt uri={item.albumArt} type={item.type} size={50} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={[styles.mediaRowTitle, active && { color: '#22D3EE' }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.mediaRowMeta} numberOfLines={1}>
          {item.type === 'video' ? item.folder || 'Video' : item.artist || 'Unknown artist'} · {item.size}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <View style={styles.mediaFmtBadge}>
            <Text style={styles.mediaFmtBadgeText}>{item.format}</Text>
          </View>
          {external && (
            <View style={styles.mediaExtBadge}>
              <Text style={styles.mediaExtBadgeText}>↗ EXTERNAL</Text>
            </View>
          )}
          {active && (
            <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '800' }}>
              {playing ? '● PLAYING' : '❚❚ PAUSED'}
            </Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'center', marginLeft: 8 }}>
        <Text style={styles.mediaRowDuration}>{formatDurationMs(item.duration)}</Text>
        <View style={[styles.mediaPlayPill, active && styles.mediaPlayPillActive]}>
          <Text style={[styles.mediaPlayPillText, active && styles.mediaPlayPillTextActive]}>
            {active && playing ? '❚❚' : '▶'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

/** Draggable progress bar. Values are seconds. */
const SeekBar: React.FC<{
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
}> = ({ position, duration, onSeek }) => {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const widthRef = useRef(0);
  widthRef.current = width;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;
  const startFrac = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
          const w = widthRef.current || 1;
          const f = Math.min(1, Math.max(0, e.nativeEvent.locationX / w));
          startFrac.current = f;
          setDrag(f);
        },
        onPanResponderMove: (_e, g) => {
          const w = widthRef.current || 1;
          setDrag(Math.min(1, Math.max(0, startFrac.current + g.dx / w)));
        },
        onPanResponderRelease: (_e, g) => {
          const w = widthRef.current || 1;
          const f = Math.min(1, Math.max(0, startFrac.current + g.dx / w));
          setDrag(null);
          if (durationRef.current > 0) seekRef.current(f * durationRef.current);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    [],
  );

  const frac =
    drag !== null ? drag : duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  return (
    <View
      style={styles.seekBarHit}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}>
      <View style={styles.seekTrack}>
        <View style={[styles.seekFill, { width: `${frac * 100}%` }]} />
      </View>
      <View style={[styles.seekKnob, { left: Math.max(0, frac * width - 7) }]} />
    </View>
  );
};

/** Full player sheet: artwork / video surface, scrubber, transport controls. */
const NowPlayingSheet: React.FC<{
  visible: boolean;
  item: DeviceMediaItem | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  error: string | null;
  broadcastToRoom: boolean;
  shuffle: boolean;
  onClose: () => void;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
  onToggleBroadcast: () => void;
  onToggleShuffle: () => void;
  onOpenExternal: () => void;
  onOpenFullscreen: () => void;
}> = p => {
  const item = p.item;
  const forward = p.duration > 0 ? Math.min(p.duration, p.position + 10) : p.position + 10;
  const { width: sheetWinW, height: sheetWinH } = useWindowDimensions();
  const isSheetLandscape = sheetWinW > sheetWinH;

  // Auto-switch to true fullscreen video if phone is rotated sideways
  useEffect(() => {
    if (p.visible && item?.type === 'video' && isSheetLandscape) {
      p.onOpenFullscreen();
    }
  }, [p.visible, item?.type, isSheetLandscape, p.onOpenFullscreen]);
  return (
    <Modal visible={p.visible && !!item} transparent animationType="slide" onRequestClose={p.onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {item && (
            <>
              <View style={styles.sheetTopRow}>
                <Text style={styles.sheetBadge}>
                  {item.type === 'video' ? 'VIDEO PLAYER' : 'NOW PLAYING'}
                </Text>
                <TouchableOpacity
                  onPress={p.onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.sheetClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {item.type === 'video' ? (
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={styles.videoSurface}
                  onPress={p.onOpenFullscreen}>
                  <VideoPlayer
                    uri={webMediaUri(item.uri)}
                    audioUri={webMediaAudio(item.uri)}
                    isPlaying={p.isPlaying}
                    resizeMode="contain"
                  />
                  <View style={styles.fullscreenPill} pointerEvents="none">
                    <Text style={styles.fullscreenPillText}>⛶ Fullscreen</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <MediaArt uri={item.albumArt} type="audio" size={196} radius={18} />
              )}

              <Text style={styles.sheetTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.sheetArtist} numberOfLines={1}>
                {item.artist}
                {item.album ? ` • ${item.album}` : ''} • {item.format} • {item.size}
              </Text>

              {p.error ? (
                <View style={styles.mediaErrorBox}>
                  <Text style={styles.mediaErrorText}>
                    This file won't play in the built-in player.
                  </Text>
                  <TouchableOpacity style={styles.mediaErrorBtn} onPress={p.onOpenExternal}>
                    <Text style={styles.mediaErrorBtnText}>Open in another player ↗</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <SeekBar position={p.position} duration={p.duration} onSeek={p.onSeek} />
              <View style={styles.sheetTimeRow}>
                <Text style={styles.sheetTime}>{formatDurationMs(p.position * 1000)}</Text>
                <Text style={styles.sheetTime}>{formatDurationMs(p.duration * 1000)}</Text>
              </View>

              <View style={styles.sheetControls}>
                <TouchableOpacity style={styles.sheetSideBtn} onPress={p.onPrev}>
                  <Text style={styles.sheetSideBtnText}>⏮</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.sheetSkipBtn}
                  onPress={() => p.onSeek(Math.max(0, p.position - 10))}>
                  <Text style={styles.sheetSkipText}>-10</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetPlayBtn} onPress={p.onToggle}>
                  <Text style={styles.sheetPlayText}>{p.isPlaying ? '⏸' : '▶'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetSkipBtn} onPress={() => p.onSeek(forward)}>
                  <Text style={styles.sheetSkipText}>+10</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetSideBtn} onPress={p.onNext}>
                  <Text style={styles.sheetSideBtnText}>⏭</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetSideBtn} onPress={p.onStop}>
                  <Text style={[styles.sheetSideBtnText, { color: '#F87171' }]}>⏹</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sheetFooter}>
                <TouchableOpacity
                  style={[styles.sheetChip, p.shuffle && styles.sheetChipOn]}
                  onPress={p.onToggleShuffle}>
                  <Text style={[styles.sheetChipText, p.shuffle && styles.sheetChipTextOn]}>
                    🔀 Shuffle
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sheetChip, p.broadcastToRoom && styles.sheetChipOn]}
                  onPress={p.onToggleBroadcast}>
                  <Text style={[styles.sheetChipText, p.broadcastToRoom && styles.sheetChipTextOn]}>
                    {p.broadcastToRoom ? '📡 Room Sync' : '🔕 Room Sync'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sheetChip} onPress={p.onOpenExternal}>
                  <Text style={styles.sheetChipText}>↗ Another app</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ─── Error Boundary ─────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('RootErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#050811', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#06B6D4', fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>SyncBuddy</Text>
          <Text style={{ color: '#F43F5E', fontSize: 16, textAlign: 'center', marginBottom: 16 }}>
            Something went wrong while loading the interface.
          </Text>
          <Text style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error?.message || 'Unknown initialization error'}
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: '#06B6D4', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
            onPress={() => this.setState({ hasError: false })}
          >
            <Text style={{ color: '#050811', fontWeight: 'bold' }}>Try Again</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ─── Main Application ─────────────────────────────────────────────────────────

function MainApp(): React.JSX.Element {
  // Navigation State
  const [activePage, setActivePage] = useState<NavigationPage>('host');

  // Network & LAN Peer-to-Peer State
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [hostParticipants, setHostParticipants] = useState<Participant[]>([]);
  const [discoveredRooms, setDiscoveredRooms] = useState<DiscoveredRoom[]>([]);
  const [deviceId] = useState<string>(() => 'dev_' + Math.random().toString(36).substring(2, 8));

  // Bluetooth & Hardware State
  const [btEnabled, setBtEnabled] = useState<boolean>(true);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanCountdown, setScanCountdown] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<FilterTab>('All');
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'success' | 'warn' | 'error' } | null>(null);

  // Host Room State (Pure 4-digit Room Number, no letters)
  const [roomCode, setRoomCode] = useState<string>(() =>
    Math.floor(1000 + Math.random() * 9000).toString(),
  );
  const [isHostBroadcasting, setIsHostBroadcasting] = useState<boolean>(false);
  const [activeTrack, setActiveTrack] = useState<AudioTrack>(AUDIO_TRACKS[0]);
  const [selectedFileUri, setSelectedFileUri] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [deviceSongs, setDeviceSongs] = useState<Array<{ id: string; title: string; artist: string; duration: number; uri: string }>>([]);
  const [songSearch, setSongSearch] = useState<string>('');
  const [isSongPaused, setIsSongPaused] = useState<boolean>(false);
  const [masterVolume, setMasterVolume] = useState<number>(85);
  const [broadcastElapsed, setBroadcastElapsed] = useState<number>(0);

  // Media Player State (Google Media3 / VLC / My Files style)
  const [mediaFiles, setMediaFiles] = useState<DeviceMediaItem[]>([]);
  const [mediaCategory, setMediaCategory] = useState<'all' | 'audio' | 'video'>('all');
  const [mediaSearch, setMediaSearch] = useState<string>('');
  const [isLoadingMedia, setIsLoadingMedia] = useState<boolean>(false);
  const [currentMedia, setCurrentMedia] = useState<DeviceMediaItem | null>(null);
  const [isMediaPlaying, setIsMediaPlaying] = useState<boolean>(false);
  const [playbackPos, setPlaybackPos] = useState<number>(0);
  const [playbackDur, setPlaybackDur] = useState<number>(0);
  const [broadcastToRoom, setBroadcastToRoom] = useState<boolean>(true);
  const [mediaRenderLimit, setMediaRenderLimit] = useState<number>(60);
  const [showPlayer, setShowPlayer] = useState<boolean>(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  // Immersive fullscreen player (replaces the old no-op fullscreen pill).
  const [showFullscreen, setShowFullscreen] = useState<boolean>(false);

  // Join Room State (Listener)
  const [inputRoomCode, setInputRoomCode] = useState<string>('');
  const [inputHostIp, setInputHostIp] = useState<string>('');
  const [joinedRoom, setJoinedRoom] = useState<{ code: string; hostName: string; hostIp: string; participantsCount: number } | null>(null);
  const [listenerVolume, setListenerVolume] = useState<number>(80);
  const [showQRScanner, setShowQRScanner] = useState<boolean>(false);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [joinFeedback, setJoinFeedback] = useState<{
    type: 'warn' | 'error';
    message: string;
    suggestedRoom?: DiscoveredRoom;
  } | null>(null);

  // Walkie-Talkie (PTT) State (Unified Room Voice, No Channels)
  const [isTalking, setIsTalking] = useState<boolean>(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);

  // Voice noise cancellation. The heavy lifting happens in Kotlin; these mirror
  // its state so the UI can show a real meter and let the user tune it.
  const [noiseCancelOn, setNoiseCancelOn] = useState<boolean>(true);
  const [noiseStrength, setNoiseStrength] = useState<number>(0.75);
  const [noiseStats, setNoiseStats] = useState<{
    reductionDb: number;
    inputLevel: number;
    outputLevel: number;
    gain: number;
    reductionRatio: number;
  } | null>(null);

  // Refs & Timers
  const toastTimer = useRef<any>(null);
  const scanTimer = useRef<any>(null);
  const hostTimer = useRef<any>(null);
  const heartbeatTimer = useRef<any>(null);
  const netPollTimer = useRef<any>(null);

  const networkInfoRef = useRef<NetworkInfo | null>(networkInfo);
  networkInfoRef.current = networkInfo;
  const roomCodeRef = useRef<string>(roomCode);
  roomCodeRef.current = roomCode;
  const deviceIdRef = useRef<string>(deviceId);
  deviceIdRef.current = deviceId;

  const pttPulse = useRef(new Animated.Value(1)).current;
  const waveAnim1 = useRef(new Animated.Value(0.3)).current;
  const waveAnim2 = useRef(new Animated.Value(0.7)).current;
  const waveAnim3 = useRef(new Animated.Value(0.4)).current;
  const waveAnim4 = useRef(new Animated.Value(0.8)).current;

  const showToast = useCallback(
    (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ msg, type });
      toastTimer.current = setTimeout(() => setToast(null), 3800);
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Network Detection & Periodic Poller
  // ─────────────────────────────────────────────────────────────────────────────
  const refreshNetworkInfo = useCallback(async () => {
    try {
      const info = await NativeNetwork.getNetworkInfo();
      setNetworkInfo(info);
    } catch { }
  }, []);

  useEffect(() => {
    refreshNetworkInfo();
    netPollTimer.current = setInterval(refreshNetworkInfo, 4000);
    return () => {
      if (netPollTimer.current) clearInterval(netPollTimer.current);
    };
  }, [refreshNetworkInfo]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Host Local Server Management (Real Port 8942)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activePage === 'host') {
      // Start Host Server on port 8942
      NativeNetwork.startRoomServer(roomCode, 8942)
        .then(() => {
          NativeNetwork.getParticipants().then(setHostParticipants).catch(() => { });
        })
        .catch(() => { });
    }
  }, [activePage, roomCode]);

  // Listen to Host Events (Listener Joined / Left / PTT)
  useEffect(() => {
    const subJoined = NativeNetwork.onListenerJoined((e: ListenerJoinedEvent) => {
      showToast(`🔔 ${e.name} (${e.ip}) joined the room!`, 'success');
      NativeNetwork.getParticipants().then(setHostParticipants).catch(() => { });
    });

    const subLeft = NativeNetwork.onListenerLeft((e: ListenerLeftEvent) => {
      showToast(`ℹ️ ${e.name} left the room`, 'info');
      NativeNetwork.getParticipants().then(setHostParticipants).catch(() => { });
    });

    const subPtt = NativeNetwork.onPttMessage((e: PttMessageEvent) => {
      if (e.isTalking) {
        setActiveSpeaker(e.speakerName);
      } else {
        setActiveSpeaker(null);
      }
    });

    return () => {
      subJoined?.remove();
      subLeft?.remove();
      subPtt?.remove();
    };
  }, [showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Listener LAN Auto-Discovery (Port 8943 UDP Beacons)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activePage === 'join') {
      NativeNetwork.startDiscovery().catch(() => { });

      const subDiscover = NativeNetwork.onRoomDiscovered((r: DiscoveredRoom) => {
        // Never discover self: check deviceId, IP, roomCode, and deviceName
        const myIp = (networkInfoRef.current?.ipAddress || '').trim();
        const hostIp = (r.hostIp || '').trim();
        const curCode = roomCodeRef.current;
        const myName = (networkInfoRef.current?.deviceName || '').toLowerCase();
        const hostName = (r.hostName || '').toLowerCase();

        if (r.deviceId && r.deviceId === deviceIdRef.current) return;
        if (myIp && hostIp && (hostIp === myIp || hostIp.startsWith(myIp) || myIp.startsWith(hostIp))) return;
        if (curCode && r.roomCode === curCode) return;
        if (myName && hostName && (hostName.includes(myName) || myName.includes(hostName))) return;

        setDiscoveredRooms(prev => {
          const exists = prev.some(item => item.hostIp === r.hostIp && item.roomCode === r.roomCode);
          if (exists) return prev;
          showToast(`🌟 Room found on your network: ${r.hostName} (#${r.roomCode})`, 'info');
          return [...prev, { ...r, lastDiscovered: Date.now() }];
        });
      });

      return () => {
        subDiscover?.remove();
        NativeNetwork.stopDiscovery().catch(() => { });
      };
    }
  }, [activePage, showToast]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Unified Audio Receiver (Runs only for Listeners or Walkie-Talkie; Host is the source)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Only listeners (joined a room) or users in walkie-talkie mode (when not transmitting) should receive audio.
    // Host is the broadcast source and should NEVER receive its own broadcast audio!
    const shouldReceiveAudio = !!joinedRoom || (activePage === 'walkie' && !isTalking);
    if (shouldReceiveAudio) {
      NativeNetwork.startAudioReceiver().catch(() => {});
    } else {
      NativeNetwork.stopAudioReceiver().catch(() => {});
    }
  }, [joinedRoom, activePage, isTalking]);

  // Listener Heartbeat Polling Loop
  useEffect(() => {
    if (joinedRoom && joinedRoom.hostIp) {
      heartbeatTimer.current = setInterval(async () => {
        try {
          const res = await NativeNetwork.sendHeartbeat(joinedRoom.hostIp, 8942, deviceId);
          setJoinedRoom(prev => (prev ? { ...prev, participantsCount: res.participantsCount } : null));
        } catch {
          // Host unreachable
        }
      }, 2500);
    } else {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    }
    return () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    };
  }, [joinedRoom, deviceId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Real-time Status Notification (Only shown when active audio session or room exists)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (Platform.OS === 'android') {
        NativeNetwork.dismissPersistentNotification().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Only show notification if an actual session or stream is actively in progress
    const isHostingWithGuests = activePage === 'host' && hostParticipants.length > 0;
    const isStreamingMedia = isMediaPlaying && broadcastToRoom;
    const isRoomActive =
      isTalking ||
      !!activeSpeaker ||
      isHostBroadcasting ||
      isStreamingMedia ||
      !!joinedRoom ||
      isHostingWithGuests;

    if (!isRoomActive) {
      // Nothing running in background - dismiss notification immediately!
      NativeNetwork.dismissPersistentNotification().catch(() => {});
      return;
    }

    let title = 'SyncBuddy • Active 🟢';
    let msg = 'Offline audio sync is running in the background';

    if (isTalking) {
      title = 'SyncBuddy • You are speaking… 🎙️';
      msg = 'Your voice is being broadcast live';
    } else if (activeSpeaker) {
      title = `SyncBuddy • ${activeSpeaker} is speaking 🔊`;
      msg = 'Live walkie-talkie voice';
    } else if (isHostBroadcasting) {
      const count = hostParticipants.length;
      title = `SyncBuddy • Broadcasting 🔴 (Room #${roomCode})`;
      msg = `Music playing on every headphone • ${count > 0 ? `${count} listening` : 'waiting for listeners'}`;
    } else if (isStreamingMedia) {
      title = 'SyncBuddy • Media streaming 🎵';
      msg = `Audio/video playing on every device (${hostParticipants.length} connected)`;
    } else if (isHostingWithGuests) {
      const count = hostParticipants.length;
      title = `SyncBuddy • Host room #${roomCode} 📡`;
      msg = `${count} devices connected • ready to broadcast`;
    } else if (joinedRoom) {
      title = `SyncBuddy • Connected 🎧 (Room #${joinedRoom.code})`;
      msg = `Host: ${joinedRoom.hostName} • audio sync and walkie-talkie on`;
    }

    NativeNetwork.showPersistentNotification(title, msg).catch(() => {});
  }, [
    activePage,
    roomCode,
    isHostBroadcasting,
    isMediaPlaying,
    broadcastToRoom,
    hostParticipants.length,
    joinedRoom,
    isTalking,
    activeSpeaker,
  ]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Initial Hardware Setup & Permissions
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android') {
      const initAndroid = async () => {
        try {
          const reqs: any[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
          if (typeof Platform.Version === 'number' && Platform.Version >= 31) {
            reqs.push(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            );
          }
          if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
            reqs.push('android.permission.POST_NOTIFICATIONS', 'android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VIDEO');
          } else {
            reqs.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
          }
          await PermissionsAndroid.requestMultiple(reqs);
        } catch { }

        try {
          loadDeviceMedia('all');
          NativeNetwork.getDeviceAudioFiles().then(setDeviceSongs).catch(() => {});
        } catch { }

        try {
          const enabled = await NativeBluetooth.isBluetoothEnabled();
          setBtEnabled(enabled);

          const bonded = await NativeBluetooth.getBondedDevices();
          if (bonded && bonded.length > 0) {
            const mapped: BluetoothDevice[] = bonded.map(b => ({
              id: b.id,
              name: b.name,
              type: detectDeviceType(b.name),
              rssi: b.isConnected ? -42 : -85,
              battery: b.battery,
              status: (b.isConnected ? 'Connected' : 'Paired') as DeviceStatus,
              macAddress: b.macAddress,
              leAudioSupport: true,
              isSelected: b.isConnected,
              volume: 80,
            }));
            setDevices(mapped);
          }
        } catch { }
      };

      initAndroid();

      let subState: any = null;
      let subConn: any = null;
      try {
        const emitter = createBluetoothStateEmitter();
        subState = emitter?.addListener(BT_EVENTS.STATE_CHANGED, ({ state }) => {
          setBtEnabled(state === 'on');
        });

        subConn = emitter?.addListener(
          BT_EVENTS.DEVICE_CONNECTION_CHANGED,
          ({ macAddress, connected, battery }) => {
            setDevices(prev =>
              prev.map(d => {
                if (d.macAddress.toLowerCase() === (macAddress || '').toLowerCase()) {
                  return {
                    ...d,
                    status: (connected ? 'Connected' : 'Paired') as DeviceStatus,
                    battery: battery ?? d.battery,
                    isSelected: connected,
                    rssi: connected ? -42 : -85,
                  };
                }
                return d;
              }),
            );
            showToast(
              connected ? 'Headphones connected!' : 'Headphones disconnected',
              connected ? 'success' : 'warn',
            );
          },
        );
      } catch { }

      return () => {
        try {
          subState?.remove();
          subConn?.remove();
        } catch { }
      };
    }
  }, [showToast]);

  // Host Broadcast Timer
  useEffect(() => {
    if (isHostBroadcasting) {
      setBroadcastElapsed(0);
      hostTimer.current = setInterval(() => setBroadcastElapsed(s => s + 1), 1000);
    } else {
      if (hostTimer.current) clearInterval(hostTimer.current);
    }
    return () => {
      if (hostTimer.current) clearInterval(hostTimer.current);
    };
  }, [isHostBroadcasting]);

  // PTT Waveform Animation
  useEffect(() => {
    if (isTalking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pttPulse, { toValue: 1.15, duration: 350, useNativeDriver: true }),
          Animated.timing(pttPulse, { toValue: 1.0, duration: 350, useNativeDriver: true }),
        ]),
      ).start();

      const animateWave = (anim: Animated.Value, dur: number) => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1.0, duration: dur, useNativeDriver: false }),
            Animated.timing(anim, { toValue: 0.2, duration: dur, useNativeDriver: false }),
          ]),
        ).start();
      };
      animateWave(waveAnim1, 280);
      animateWave(waveAnim2, 340);
      animateWave(waveAnim3, 220);
      animateWave(waveAnim4, 400);
    } else {
      pttPulse.setValue(1);
      waveAnim1.setValue(0.3);
      waveAnim2.setValue(0.7);
      waveAnim3.setValue(0.4);
      waveAnim4.setValue(0.8);
    }
  }, [isTalking, pttPulse, waveAnim1, waveAnim2, waveAnim3, waveAnim4]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Bluetooth Scanner & Hardware Actions
  // ─────────────────────────────────────────────────────────────────────────────
  const handleStartScan = async () => {
    if (!btEnabled) {
      showToast('Turn on Bluetooth first', 'warn');
      return;
    }
    if (isScanning) return;

    setIsScanning(true);
    setScanCountdown(10);
    showToast('Scanning for 10 seconds (battery saver mode)…', 'info');

    if (scanTimer.current) clearInterval(scanTimer.current);
    scanTimer.current = setInterval(() => {
      setScanCountdown(prev => {
        if (prev <= 1) {
          clearInterval(scanTimer.current);
          setIsScanning(false);
          showToast('Scan complete. Bluetooth radio is back in sleep mode.', 'info');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    if (Platform.OS === 'android') {
      try {
        const bonded = await NativeBluetooth.getBondedDevices();
        if (bonded && bonded.length > 0) {
          const mapped: BluetoothDevice[] = bonded.map(b => ({
            id: b.id,
            name: b.name,
            type: detectDeviceType(b.name),
            rssi: b.isConnected ? -42 : -85,
            battery: b.battery,
            status: (b.isConnected ? 'Connected' : 'Paired') as DeviceStatus,
            macAddress: b.macAddress,
            leAudioSupport: true,
            isSelected: b.isConnected,
            volume: 80,
          }));
          setDevices(mapped);
        }
      } catch { }
    }
  };

  const handleConnectDevice = async (device: BluetoothDevice) => {
    showToast(`Connecting to ${device.name}…`, 'info');
    setDevices(prev =>
      prev.map(d => (d.id === device.id ? { ...d, status: 'Connecting' as DeviceStatus } : d)),
    );

    if (Platform.OS === 'android') {
      try {
        const alreadyConnected = await NativeBluetooth.isDeviceConnected(device.macAddress);
        if (alreadyConnected) {
          setDevices(prev =>
            prev.map(d => (d.id === device.id ? { ...d, status: 'Connected', isSelected: true, rssi: -42 } : d)),
          );
          showToast(`${device.name} is active and connected!`, 'success');
          return;
        }

        const res = await NativeBluetooth.connectDevice(device.macAddress);
        if (res.isConnected) {
          setDevices(prev =>
            prev.map(d =>
              d.id === device.id
                ? { ...d, status: 'Connected', isSelected: true, battery: res.battery ?? d.battery, rssi: -42 }
                : d,
            ),
          );
          showToast(`${device.name} connected successfully!`, 'success');
          return;
        }

        let verifiedConnected = false;
        for (let i = 0; i < 3; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const isConn = await NativeBluetooth.isDeviceConnected(device.macAddress);
          if (isConn) {
            verifiedConnected = true;
            break;
          }
        }

        if (verifiedConnected) {
          setDevices(prev =>
            prev.map(d => (d.id === device.id ? { ...d, status: 'Connected', isSelected: true, rssi: -42 } : d)),
          );
          showToast(`${device.name} connected successfully!`, 'success');
        } else {
          setDevices(prev =>
            prev.map(d => (d.id === device.id ? { ...d, status: 'Paired', isSelected: false, rssi: -85 } : d)),
          );
          showToast(`${device.name} is off or out of range — turn it on first.`, 'error');
        }
      } catch (err: any) {
        setDevices(prev =>
          prev.map(d => (d.id === device.id ? { ...d, status: 'Paired', isSelected: false } : d)),
        );
        showToast(`Connection failed: ${err?.message || 'Device unreachable'}`, 'error');
      }
    }
  };

  const handleDisconnectDevice = (device: BluetoothDevice) => {
    setDevices(prev =>
      prev.map(d => (d.id === device.id ? { ...d, status: 'Paired' as DeviceStatus, isSelected: false } : d)),
    );
    showToast(`${device.name} Disconnected`, 'info');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Host Room & Join Room Real Network Actions
  // ─────────────────────────────────────────────────────────────────────────────
  const generateNewRoomCode = () => {
    // Pure 4 numeric digits: 1000 - 9999 (No letters)
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setRoomCode(code);
    NativeNetwork.startRoomServer(code, 8942).catch(() => { });
    showToast(`New 4-digit room code: #${code}`, 'success');
  };

  const handleToggleHostBroadcast = async () => {
    const next = !isHostBroadcasting;

    if (next) {
      try {
        if (activeTrack.source === 'file') {
          let uriToPlay = selectedFileUri;
          if (!uriToPlay) {
            const picked = await NativeNetwork.pickAudioFile();
            if (!picked || !picked.uri) {
              showToast('Please select a song first', 'warn');
              return;
            }
            setSelectedFileUri(picked.uri);
            setSelectedFileName(picked.name);
            uriToPlay = picked.uri;
          }
          await NativeNetwork.playAudioFile(uriToPlay);
        } else {
          await NativeNetwork.startAudioBroadcaster(activeTrack.source);
        }

        setIsHostBroadcasting(true);
        NativeNetwork.updateBroadcastState(true, activeTrack.title, masterVolume).catch(() => {});
        showToast(
          activeTrack.source === 'synth'
          ? `Room #${roomCode} — Cyber Sync Beat is live! ⚡`
            : activeTrack.source === 'file'
          ? `Room #${roomCode} — your saved song is playing on every phone! 🎵`
            : activeTrack.source === 'mic'
          ? `Room #${roomCode} — live mic broadcast started! 🎙️`
          : `Room #${roomCode} — system audio broadcast started! 📱`,
          'success',
        );
        if (Platform.OS === 'android') {
          NativeAuracast.startBroadcast(roomCode).catch(() => {});
        }
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('DENIED') || msg.toLowerCase().includes('permission')) {
          showToast('Audio capture permission was not granted', 'warn');
        } else {
          showToast('Could not start the broadcast', 'error');
        }
      }
    } else {
      setIsHostBroadcasting(false);
      NativeNetwork.updateBroadcastState(false, activeTrack.title, masterVolume).catch(() => {});
      if (activeTrack.source === 'file') {
        NativeNetwork.stopAudioFile().catch(() => {});
      }
      NativeNetwork.stopAudioBroadcaster().catch(() => {});
      showToast('Broadcast stopped', 'info');
    }
  };

  // Join Room over Real Local Network
  const handleJoinHost = async (targetIp: string, targetPort: number = 8942, codeToVerify?: string) => {
    if (!targetIp || targetIp.trim().length === 0) {
      setJoinFeedback({
        type: 'warn',
        message: 'Enter the host’s 4-digit room code or IP address.',
      });
      showToast('Enter the host’s IP address', 'warn');
      return;
    }

    // Never join own phone's room!
    if (networkInfo?.ipAddress && targetIp.trim() === networkInfo.ipAddress.trim()) {
      setJoinFeedback({
        type: 'warn',
        message: 'That is this phone. Join from another device.',
      });
      showToast('⚠️ That is this phone — join from another device.', 'warn');
      return;
    }

    // Never join own phone's room!
    if (networkInfo?.ipAddress && targetIp.trim() === networkInfo.ipAddress.trim()) {
      showToast('⚠️ That is this phone — join from another device.', 'warn');
      return;
    }

    setIsJoining(true);
    showToast(`Looking for the host…`, 'info');

    try {
      const myName = networkInfo?.deviceName || 'SyncBuddy Listener';
      const res = await NativeNetwork.joinRoom(targetIp.trim(), targetPort, myName, deviceId, codeToVerify);

      if (res.success === false) {
        if (res.reason === 'ROOM_CODE_MISMATCH') {
          setJoinFeedback({
            type: 'error',
            message: 'Wrong room code. Check the 4-digit code on the host screen and try again.',
          });
        showToast('🔐 Wrong room code — match the code shown on the host.', 'warn');
        } else {
          setJoinFeedback({
            type: 'error',
            message: res.message || 'Could not join this room.',
          });
            showToast(res.message || 'Could not connect to the host', 'warn');
        }
        return;
      }

      setJoinFeedback(null);
      setJoinedRoom({
        code: res.roomCode || codeToVerify || '0000',
        hostName: res.hostName || 'Host Phone',
        hostIp: targetIp.trim(),
        participantsCount: res.participantsCount || 2,
      });

      // Immediately spin up audio receiver so sound plays without waiting
      NativeNetwork.startAudioReceiver().catch(() => {});

      showToast(`✅ Joined ${res.hostName || 'the host'}'s room!`, 'success');
    } catch (e: any) {
      setJoinFeedback({
        type: 'warn',
        message: 'Host not found. Make sure both phones are on the same Wi-Fi or offline hotspot.',
      });
      showToast('🔍 Host not found. Are both phones on the same Wi-Fi or hotspot?', 'warn');
    } finally {
      setIsJoining(false);
    }
  };

  const handleQrScanResult = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // 1. If it's a URL like http://192.168.0.103:8942/join?c=7636
    if (trimmed.includes('://')) {
      try {
        const urlMatch = trimmed.match(/https?:\/\/([^:/]+)(?::(\d+))?/);
        if (urlMatch) {
          const ip = urlMatch[1];
          const port = urlMatch[2] ? parseInt(urlMatch[2], 10) : 8942;
          const codeMatch = trimmed.match(/[?&]c=([0-9a-zA-Z]+)/);
          const scannedCode = codeMatch ? codeMatch[1] : undefined;
          if (scannedCode) setInputRoomCode(scannedCode);
          handleJoinHost(ip, port, scannedCode);
          return;
        }
      } catch {}
    }

    // 2. Format: SYNCBUDDY:IP:PORT:CODE
    if (trimmed.startsWith('SYNCBUDDY:')) {
      const parts = trimmed.substring('SYNCBUDDY:'.length).split(':');
      if (parts.length >= 2) {
        const ip = parts[0];
        const port = parseInt(parts[1], 10) || 8942;
        const code = parts[2];
        if (code) setInputRoomCode(code);
        handleJoinHost(ip, port, code);
        return;
      }
    }

    // 2. If it's an IP:Port like 192.168.0.103:8942 or 192.168.0.103
    if (trimmed.includes('.')) {
      const parts = trimmed.split(':');
      const ip = parts[0];
      const port = parts[1] ? parseInt(parts[1], 10) : 8942;
      handleJoinHost(ip, port);
      return;
    }

    // 3. If it's a 4-digit code (e.g. 7636)
    if (/^\d{4}$/.test(trimmed)) {
      setInputRoomCode(trimmed);
      const matched = otherDiscoveredRooms.find(r => r.roomCode === trimmed);
      if (matched) {
        handleJoinHost(matched.hostIp, matched.port, trimmed);
        return;
      }
    }

    showToast(`Scanned data: ${trimmed}`, 'info');
  };

  const handleOpenQrScanner = async () => {
    try {
      const scanned = await NativeNetwork.openCameraScanner();
      if (scanned) {
        showToast('QR code scanned successfully!', 'success');
        handleQrScanResult(scanned);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (err?.code !== 'CANCELLED' && !msg.toLowerCase().includes('cancel')) {
        setShowQRScanner(true);
        showToast('Camera unavailable — type the code or IP instead', 'info');
      }
    }
  };

  const handleManualJoin = () => {
    const target = (inputRoomCode || inputHostIp).trim();
    if (!target) {
      setJoinFeedback({
        type: 'warn',
        message: 'Enter the 4-digit room code or the host’s IP address.',
      });
      showToast('Enter the host’s 4-digit room code', 'warn');
      return;
    }

    // 1. If entered an IP address (contains '.')
    if (target.includes('.')) {
      handleJoinHost(target);
      return;
    }

    // 2. Check if entered 4-digit code matches an auto-discovered room on LAN
    const matched = otherDiscoveredRooms.find(r => r.roomCode === target);
    if (matched) {
      handleJoinHost(matched.hostIp, matched.port, target);
      return;
    }

    // 3. If there is an active room on LAN, but user typed a DIFFERENT 4-digit number:
    if (otherDiscoveredRooms.length > 0) {
      const topRoom = otherDiscoveredRooms[0];
      setJoinFeedback({
        type: 'warn',
        message: `Room #${target} not found. The nearest active room is #${topRoom.roomCode} (${topRoom.hostName}).`,
        suggestedRoom: topRoom,
      });
      showToast(`🔍 Room #${target} not found. Double-check the host code.`, 'warn');
      return;
    }

    // 4. If connected to Hotspot, try gateway IP (usually .1) with the typed room code
    if (networkInfo?.ipAddress) {
      const parts = networkInfo.ipAddress.split('.');
      if (parts.length === 4) {
        const defaultHostIp = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
        handleJoinHost(defaultHostIp, 8942, target);
        return;
      }
    }

    // 5. Professional friendly fallback message
    setJoinFeedback({
      type: 'warn',
      message: `Room #${target} is not on this network. Re-check the code on the host screen.`,
    });
    showToast(`🔍 Room #${target} is not active. Check the host screen.`, 'warn');
  };

  const handleLeaveRoom = async () => {
    if (joinedRoom) {
      try {
        await NativeNetwork.leaveRoom(joinedRoom.hostIp, 8942, deviceId);
      } catch { }
    }
    setJoinedRoom(null);
    setInputRoomCode('');
    setInputHostIp('');
    showToast('You left the room', 'info');
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Walkie-Talkie (PTT) Unified Room Broadcast
  // ─────────────────────────────────────────────────────────────────────────────
  const handlePttPressIn = async () => {
    try {
      if (Platform.OS === 'android') {
        const hasMic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (!hasMic) {
          const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
          if (res !== PermissionsAndroid.RESULTS.GRANTED) {
      showToast('Microphone permission is required!', 'error');
            return;
          }
        }
      }

      setIsTalking(true);
      const myName = networkInfo?.deviceName || 'This Phone';
      setActiveSpeaker(`${myName} (You)`);
      showToast(
        noiseCancelOn
          ? '🎙️ You are live — noise cancellation on'
          : '🎙️ You are live (noise cancellation off)',
        'info'
      );

      // Push the current noise-cancellation settings down before the stream
      // starts, so the very first packet is already cleaned.
      NativeNetwork.setNoiseSuppression(noiseCancelOn, noiseStrength).catch(() => {});

      // 1. Start real low-latency microphone voice stream over UDP
      await NativeNetwork.startAudioBroadcaster('mic');

      // 2. Instant UDP PTT signaling broadcast
      NativeNetwork.broadcastPtt(myName, true).catch(() => {});

      // 3. If joined to a host, also send HTTP POST relay
      if (joinedRoom && joinedRoom.hostIp) {
        NativeNetwork.sendPttMessage(joinedRoom.hostIp, 8942, myName, true).catch(() => {});
      }
    } catch (err: any) {
      setIsTalking(false);
      showToast(`Could not start the mic: ${err?.message || ''}`, 'error');
    }
  };

  const handlePttPressOut = async () => {
    setIsTalking(false);
    setActiveSpeaker(null);
    const myName = networkInfo?.deviceName || 'This Phone';

    try {
      // 1. Stop microphone streaming
      await NativeNetwork.stopAudioBroadcaster();

      // 2. Instant UDP PTT signaling release
      NativeNetwork.broadcastPtt(myName, false).catch(() => {});

      // 3. If joined to a host, also send HTTP POST relay
      if (joinedRoom && joinedRoom.hostIp) {
        NativeNetwork.sendPttMessage(joinedRoom.hostIp, 8942, myName, false).catch(() => {});
      }
    } catch {}
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Noise-cancellation controls
  // ─────────────────────────────────────────────────────────────────────────────
  const toggleNoiseCancellation = async () => {
    const next = !noiseCancelOn;
    setNoiseCancelOn(next);
    await NativeNetwork.setNoiseSuppression(next, noiseStrength).catch(() => {});
    showToast(next ? '🔇 Noise cancellation on' : 'Noise cancellation off', 'info');
  };

  const changeNoiseStrength = async (value: number) => {
    const clamped = Math.max(0.2, Math.min(1, value));
    setNoiseStrength(clamped);
    await NativeNetwork.setNoiseSuppression(noiseCancelOn, clamped).catch(() => {});
  };

  // Poll live DSP measurements while the user is talking, so the meter shows
  // how much noise is actually being removed rather than a fake animation.
  useEffect(() => {
    if (!isTalking) {
      setNoiseStats(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const s = await NativeNetwork.getNoiseSuppressionStats().catch(() => null);
      if (!cancelled) setNoiseStats(s);
    };
    tick();
    const id = setInterval(tick, 200);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isTalking]);

  // Helpers
  const connectedCount = hostParticipants.length + 1; // +1 for host itself
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const loadDeviceMedia = useCallback(async (filter: 'all' | 'audio' | 'video' = 'all') => {
    setIsLoadingMedia(true);
    try {
      const files = await NativeNetwork.getDeviceMediaFiles(filter);
      setMediaFiles(files);
    } catch {
      setMediaFiles([]);
    } finally {
      setIsLoadingMedia(false);
    }
  }, []);

  // ── Media library derivation: filtered, newest-first, progressively paged ──
  const sortedMedia = useMemo(() => {
    const q = mediaSearch.trim().toLowerCase();
    return mediaFiles
      .filter(m => {
        if (mediaCategory !== 'all' && m.type !== mediaCategory) return false;
        if (!q) return true;
        return (
          (m.title || '').toLowerCase().includes(q) ||
          (m.artist || '').toLowerCase().includes(q) ||
          (m.album || '').toLowerCase().includes(q) ||
          (m.format || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  }, [mediaFiles, mediaCategory, mediaSearch]);

  const visibleMedia = useMemo(
    () => sortedMedia.slice(0, mediaRenderLimit),
    [sortedMedia, mediaRenderLimit],
  );
  const mediaGroups = useMemo(() => groupMediaByDate(visibleMedia), [visibleMedia]);

  const audioCount = useMemo(() => mediaFiles.filter(m => m.type === 'audio').length, [mediaFiles]);
  const videoCount = useMemo(() => mediaFiles.filter(m => m.type === 'video').length, [mediaFiles]);
  const librarySizeLabel = useMemo(() => {
    const bytes = mediaFiles.reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
    if (bytes <= 0) return '—';
    return bytes >= 1073741824
      ? `${(bytes / 1073741824).toFixed(2)} GB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
  }, [mediaFiles]);

  const nextMediaRef = useRef<(() => void) | null>(null);
  const mediaCountRef = useRef(0);
  mediaCountRef.current = sortedMedia.length;

  const handlePlayMedia = async (item: DeviceMediaItem) => {
    try {
      setMediaError(null);
      setCurrentMedia(item);
      setPlaybackPos(0);
      setPlaybackDur(item.duration > 0 ? item.duration / 1000 : 0);
      setIsMediaPlaying(true);
      if (item.type === 'video') {
        setShowFullscreen(true);
        setShowPlayer(false);
      } else {
        setShowPlayer(true);
        setShowFullscreen(false);
      }

      // Containers Media3 cannot demux (AVI, MPEG-TS, WMV, RM...) are handed to a
      // real external player instead of failing silently inside the app.
      if (needsExternalPlayer(item)) {
        setIsMediaPlaying(false);
        setCurrentMedia(null);
        setShowPlayer(false);
        await NativeNetwork.stopMediaFile();
        const opened = await NativeNetwork.openWithExternalPlayer(item.uri, item.mimeType || '');
        showToast(
          opened
            ? `↗ Opening ${item.title} in another player`
            : 'No installed player can open this format',
          opened ? 'info' : 'error',
        );
        return;
      }

      if (broadcastToRoom) {
        setIsHostBroadcasting(true);
        NativeNetwork.updateBroadcastState(true, item.title, masterVolume).catch(() => {});
      }

      await NativeNetwork.playMediaFile(
        item.uri,
        item.type === 'video',
        broadcastToRoom,
        item.mimeType || '',
        item.duration > 0 ? item.duration / 1000 : 0,
      );

      showToast(
        item.type === 'video'
          ? `🎬 ${item.title} — ${broadcastToRoom ? 'live in room' : 'this phone only'} [${item.format}]`
          : `▶️ ${item.title} — ${broadcastToRoom ? 'live in room' : 'this phone only'} [${item.format}]`,
        'success',
      );
    } catch {
      showToast('Could not play this media', 'error');
    }
  };

  const handleTogglePlayPause = async () => {
    if (!currentMedia) return;
    if (isMediaPlaying) {
      await NativeNetwork.pauseMediaFile();
      setIsMediaPlaying(false);
      showToast('⏸️ Paused', 'info');
    } else {
      await NativeNetwork.resumeMediaFile();
      setIsMediaPlaying(true);
      showToast('▶️ Playing', 'success');
    }
  };

  const handleStopMedia = async () => {
    await NativeNetwork.stopMediaFile();
    setIsMediaPlaying(false);
    setPlaybackPos(0);
    setShowPlayer(false);
    setCurrentMedia(null);
    if (isHostBroadcasting && !joinedRoom) {
      setIsHostBroadcasting(false);
      NativeNetwork.updateBroadcastState(false, '', masterVolume).catch(() => {});
    }
    showToast('⏹️ Playback stopped', 'info');
  };

  const handleSeek = async (newPosSec: number) => {
    setPlaybackPos(newPosSec);
    await NativeNetwork.seekMediaFile(newPosSec);
  };

  const handleRewind10 = async () => {
    await handleSeek(Math.max(0, playbackPos - 10));
  };

  const handleForward10 = async () => {
    const maxDur = playbackDur > 0 ? playbackDur : 999999;
    await handleSeek(Math.min(maxDur, playbackPos + 10));
  };

  const handleNextMedia = (direction: 1 | -1 = 1) => {
    if (!currentMedia || sortedMedia.length === 0) return;
    const idx = sortedMedia.findIndex(m => m.id === currentMedia.id);
    if (idx < 0) return;
    let nextIdx: number;
    if (isShuffle && sortedMedia.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * sortedMedia.length);
      } while (nextIdx === idx);
    } else {
      nextIdx = (idx + direction + sortedMedia.length) % sortedMedia.length;
    }
    handlePlayMedia(sortedMedia[nextIdx]);
  };

  // Auto-advance keeps playback continuous across the whole library.
  nextMediaRef.current = () => handleNextMedia(1);

  const handleOpenExternal = async () => {
    if (!currentMedia) return;
    const opened = await NativeNetwork.openWithExternalPlayer(
      currentMedia.uri,
      currentMedia.mimeType || '',
    );
    if (!opened) showToast('No external player found', 'error');
  };

  const toggleBroadcastToRoom = async () => {
    const next = !broadcastToRoom;
    setBroadcastToRoom(next);
    if (currentMedia) {
      if (next) {
        setIsHostBroadcasting(true);
        NativeNetwork.updateBroadcastState(true, currentMedia.title, masterVolume).catch(() => {});
      } else {
        setIsHostBroadcasting(false);
        NativeNetwork.updateBroadcastState(false, '', masterVolume).catch(() => {});
      }
      // Re-opening the file restarts the player at 0:00, so remember where the
      // user actually was and jump straight back — switching room sync must not
      // throw away their place in the track.
      const resumeAt = playbackPos;
      await NativeNetwork.playMediaFile(
        currentMedia.uri,
        currentMedia.type === 'video',
        next,
        currentMedia.mimeType || '',
        currentMedia.duration > 0 ? currentMedia.duration / 1000 : 0,
      );
      if (resumeAt > 0.5) {
        await NativeNetwork.seekMediaFile(resumeAt);
        setPlaybackPos(resumeAt);
      }
      if (isMediaPlaying) await NativeNetwork.resumeMediaFile();
    }
    showToast(next ? '📡 Broadcasting live to the room' : '🔕 Playing on this phone only', 'info');
  };

  const handlePickCustomMedia = async () => {
    const picked = await NativeNetwork.pickAudioFile();
    if (picked && picked.uri) {
      const ext = picked.name.includes('.')
        ? picked.name.substring(picked.name.lastIndexOf('.') + 1).toUpperCase()
        : 'MEDIA';
      const isVideo = ['MP4', 'MKV', 'WEBM', '3GP', 'MOV', 'AVI'].includes(ext);
      const customItem: DeviceMediaItem = {
        id: 'picked_' + Date.now(),
        title: picked.name,
        artist: isVideo ? `Video Audio (${ext})` : 'Storage File',
        duration: 0,
        uri: picked.uri,
        type: isVideo ? 'video' : 'audio',
        format: ext,
        size: 'Custom File',
        dateAdded: Date.now(),
        mimeType: '',
      };
      await handlePlayMedia(customItem);
    }
  };

  const handleRequestMediaPermissions = async () => {
    if (Platform.OS !== 'android') return;
    try {
      const reqs: any[] = [];
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        reqs.push('android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_MEDIA_VIDEO');
      } else {
        reqs.push(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
      }
      await PermissionsAndroid.requestMultiple(reqs);
      await loadDeviceMedia('all');
    } catch {}
  };

  // Poll live playback position and duration
  useEffect(() => {
    let timer: any = null;
    if (isMediaPlaying) {
      timer = setInterval(async () => {
        try {
          const state = await NativeNetwork.getMediaPlaybackState();
          if (state) {
            setPlaybackPos(state.position);
            if (state.duration > 0) setPlaybackDur(state.duration);
            if (!state.isPlaying && state.duration > 0 && state.position >= state.duration - 0.5) {
              // Track finished: roll on to the next file instead of going silent.
              if (mediaCountRef.current > 1) {
                nextMediaRef.current?.();
              } else {
                setIsMediaPlaying(false);
              }
            }
          }
        } catch {}
      }, 500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isMediaPlaying]);

  // Surface native playback failures (unsupported codec / corrupt file) so the
  // sheet can offer the external-player fallback instead of a silent dead end.
  useEffect(() => {
    const sub = NativeNetwork.onMediaError(e => {
      setMediaError(e?.message || 'Playback failed');
      setIsMediaPlaying(false);
    });
    return () => {
      sub?.remove();
    };
  }, []);

  // Load the library the first time the Media page is opened.
  const mediaLoadedOnce = useRef(false);
  useEffect(() => {
    if (activePage === 'media' && !mediaLoadedOnce.current) {
      mediaLoadedOnce.current = true;
      loadDeviceMedia('all');
    }
  }, [activePage, mediaCategory, loadDeviceMedia]);

  const filteredDevices = devices.filter(d => {
    const q = searchQuery.toLowerCase();
    const match = d.name.toLowerCase().includes(q) || d.macAddress.toLowerCase().includes(q);
    if (!match) return false;
    if (selectedFilter === 'All') return true;
    if (selectedFilter === 'Connected') return d.status === 'Connected';
    if (selectedFilter === 'Paired') return d.status === 'Paired';
    if (selectedFilter === 'Audio') return d.type === 'Audio';
    if (selectedFilter === 'Wearables') return d.type === 'Wearable';
    return true;
  });

  // Host QR Payload: Real scannable URL containing IP and Room Code
  const hostIp = networkInfo?.ipAddress || '192.168.43.1';
  const qrPayload = `http://${hostIp}:8942/join?c=${roomCode}`;

  // Filter out self room so device never shows or connects to itself!
  const otherDiscoveredRooms = discoveredRooms.filter(r => {
    if (r.deviceId && r.deviceId === deviceId) return false;
    const cleanHostIp = (r.hostIp || '').trim();
    const cleanMyIp = (networkInfo?.ipAddress || '').trim();
    if (cleanMyIp && cleanHostIp && (cleanHostIp === cleanMyIp || cleanHostIp.startsWith(cleanMyIp) || cleanMyIp.startsWith(cleanHostIp))) return false;
    if (r.roomCode && r.roomCode === roomCode) return false;
    const myName = (networkInfo?.deviceName || '').toLowerCase();
    const hostName = (r.hostName || '').toLowerCase();
    if (myName && hostName && (hostName.includes(myName) || myName.includes(hostName))) return false;
    return true;
  });

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050811" />

      {/* ── Toast Notification ── */}
      {toast && (
        <View
          style={[
            styles.toast,
            toast.type === 'success' && styles.toastSuccess,
            toast.type === 'error' && styles.toastError,
            toast.type === 'warn' && styles.toastWarn,
          ]}>
          <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.appTitle}>SYNCBUDDY</Text>
            <View style={styles.proPill}>
              <Text style={styles.proPillText}>v2.0 P2P</Text>
            </View>
          </View>
          <Text style={styles.subTitle}>Offline Audio Sync & Walkie-Talkie</Text>
        </View>

        {/* Real Network Status Badge */}
        <TouchableOpacity
          style={[styles.netBadge, networkInfo?.hasNetwork ? styles.netBadgeOn : styles.netBadgeOff]}
          onPress={refreshNetworkInfo}>
          <Text style={[styles.netBadgeText, networkInfo?.hasNetwork ? styles.netBadgeTextOn : styles.netBadgeTextOff]}>
            {networkInfo?.hasNetwork
              ? `● ${networkInfo.isHotspot ? 'HOTSPOT' : 'WI-FI'}`
              : '✕ OFFLINE'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Offline Network Warning & Hotspot Prompt ── */}
      {networkInfo && !networkInfo.hasNetwork && (
        <View style={styles.netWarningBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ fontSize: 18 }}>⚠️</Text>
          <Text style={styles.netWarningTitle}>No offline network is active</Text>
          </View>
          <Text style={styles.netWarningText}>
            To share music and voice offline, do either of these:{'\n'}
            1. Turn on this phone's Personal Hotspot (the other phone joins it){'\n'}
            or 2. Connect both phones to the same Wi-Fi / hotspot.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={styles.netActionBtn}
              onPress={() => NativeNetwork.openHotspotSettings()}>
              <Text style={styles.netActionBtnText}>⚙️ Turn on hotspot</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.netActionBtn, { backgroundColor: '#17171F' }]}
              onPress={() => NativeNetwork.openWifiSettings()}>
              <Text style={styles.netActionBtnText}>📶 Wi-Fi settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Active Network Info Strip ── */}
      {networkInfo && networkInfo.hasNetwork && (
        <View style={styles.netStatusStrip}>
          <View style={styles.netStatusDot} />
          <Text style={styles.netStatusText}>
            {networkInfo.isHotspot ? 'Mobile hotspot' : 'Local Wi-Fi'}: {networkInfo.ipAddress}:8942
          </Text>
          <Text style={styles.netDeviceName}>({networkInfo.deviceName})</Text>
        </View>
      )}

      {/* ── Main Page Content ── */}
      <ScrollView
        contentContainerStyle={[styles.scrollBody, currentMedia && { paddingBottom: 150 }]}
        showsVerticalScrollIndicator={false}>
        {/* ═══════════════════════════════════════════════════════════════════
            PAGE 1: 📡 HOST ROOM (REAL HTTP SERVER + PARTICIPANTS LIST)
        ═══════════════════════════════════════════════════════════════════ */}
        {activePage === 'host' && (
          <View style={styles.pageContainer}>
            {/* Room ID & QR Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={styles.cardBadge}>OFFLINE HOST ROOM</Text>
                  <Text style={styles.roomCodeTitle}>{roomCode}</Text>
                </View>
                <TouchableOpacity style={styles.regenBtn} onPress={generateNewRoomCode}>
                  <Text style={styles.regenBtnText}>⚡ New code</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.cardDesc}>
          On the other phone, enter the 4-digit room code ({roomCode}) or scan the QR code to join.
              </Text>

              {/* Real Standard ISO/IEC 18004 Scannable QR Code */}
              <View style={{ alignItems: 'center', marginVertical: 14 }}>
                <RealQRMatrix value={qrPayload} size={180} />
          <Text style={styles.qrHint}>📱 Scan with any camera or the SyncBuddy app</Text>
                <Text style={styles.qrSubHint}>Host server: {hostIp}:8942 (no internet needed)</Text>
              </View>

              {/* Real Live Connected Listeners Counter */}
              <View style={styles.listenerCounterRow}>
                <View style={styles.listenerNumberBox}>
                  <Text style={styles.listenerNumber}>{connectedCount}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listenerTitle}>
                    {connectedCount > 1
                      ? `Audio synced to ${connectedCount} devices`
                      : '1 device (you / host)'}
                  </Text>
                  <Text style={styles.listenerSub}>
                    {isHostBroadcasting ? '● Live audio broadcast running' : '○ Pick a source below to start broadcasting'}
                  </Text>
                </View>
                {isHostBroadcasting && (
                  <View style={styles.liveTimerBadge}>
                    <Text style={styles.liveTimerText}>{formatTime(broadcastElapsed)}</Text>
                  </View>
                )}
              </View>

              {/* Main Broadcast Toggle */}
              {isHostBroadcasting ? (
                <TouchableOpacity style={styles.stopBtn} onPress={handleToggleHostBroadcast}>
                  <Text style={styles.stopBtnText}>⏹ Stop Broadcast Room</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.startBtn} onPress={handleToggleHostBroadcast}>
                  <Text style={styles.startBtnText}>▶ Start Live Audio Broadcast</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Real Connected Participants List on Host ── */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>
                👥 Connected devices ({connectedCount})
              </Text>
              <Text style={styles.cardDesc}>
            Phones that join your room appear here live:
              </Text>

              {/* Host Phone */}
              <View style={styles.participantItem}>
                <Text style={{ fontSize: 20, marginRight: 10 }}>👑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.participantName}>
                    {networkInfo?.deviceName || 'This Phone'} (host / you)
                  </Text>
                  <Text style={styles.participantMeta}>IP: {hostIp}:8942 • Primary broadcaster</Text>
                </View>
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>HOST</Text>
                </View>
              </View>

              {/* Connected Listeners */}
              {hostParticipants.map((p, idx) => (
                <View key={p.id || idx} style={styles.participantItem}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>📱</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    <Text style={styles.participantMeta}>IP: {p.ip} • Live sync to headphones</Text>
                  </View>
                  <View style={styles.syncedBadge}>
                    <Text style={styles.syncedBadgeText}>● SYNCED</Text>
                  </View>
                </View>
              ))}

              {hostParticipants.length === 0 && (
                <View style={styles.noParticipantsBox}>
                  <Text style={styles.noParticipantsText}>
                No listeners yet. Open "Join Room" on another phone!
                  </Text>
                </View>
              )}
            </View>

            {/* ─── Media player card ─── */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.cardIconTile}>
                  <Text style={{ fontSize: 18 }}>🎬</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Media player</Text>
                  <Text style={[styles.cardDesc, { marginBottom: 0, marginTop: 3 }]}>
                    MP3, MP4, FLAC, WAV — one dedicated player
                  </Text>
                </View>
                <TouchableOpacity style={styles.cardCta} onPress={() => setActivePage('media')}>
                  <Text style={styles.cardCtaText}>Open ➔</Text>
                </TouchableOpacity>
              </View>

              {currentMedia && isMediaPlaying && (
                <View style={styles.nowStreamingBox}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={styles.nowStreamingLabel}>NOW PLAYING · {currentMedia.format}</Text>
                    <Text style={styles.nowStreamingTitle} numberOfLines={1}>{currentMedia.title}</Text>
                    <Text style={styles.nowStreamingTime}>{formatTime(playbackPos)} / {formatTime(playbackDur)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={styles.nowStreamingBtn} onPress={handleTogglePlayPause}>
                      <Text style={styles.nowStreamingBtnText}>{isMediaPlaying ? '⏸' : '▶'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.nowStreamingStopBtn} onPress={handleStopMedia}>
                      <Text style={styles.nowStreamingStopText}>⏹</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* Audio Stream Source & Animated Visualizer */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>Audio Stream Source</Text>
                {isHostBroadcasting && (
                  <View style={styles.visualizerRow}>
                    <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim1 }] }]} />
                    <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim2 }] }]} />
                    <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim3 }] }]} />
                    <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim4 }] }]} />
                  </View>
                )}
              </View>

              {AUDIO_TRACKS.map(t => {
                const isSelected = activeTrack.id === t.id;
                return (
                  <View key={t.id} style={{ marginBottom: 10 }}>
                    <TouchableOpacity
                      style={[styles.trackItem, isSelected && styles.trackItemActive]}
                      onPress={async () => {
                        setActiveTrack(t);
                        NativeNetwork.updateBroadcastState(isHostBroadcasting, t.title, masterVolume).catch(() => {});
                        if (isHostBroadcasting) {
                          if (t.source === 'file') {
                            if (selectedFileUri) {
                              NativeNetwork.playAudioFile(selectedFileUri).catch(() => {});
                            }
                          } else {
                            NativeNetwork.startAudioBroadcaster(t.source).catch(() => {});
                          }
                        }
                        showToast(`Source selected: ${t.title}`, 'info');
                      }}>
                      <Text style={{ fontSize: 20, marginRight: 10 }}>
                        {t.source === 'mic' ? '🎤' : t.source === 'synth' ? '⚡' : t.source === 'file' ? '🎵' : '📱'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.trackTitle, isSelected && { color: '#22D3EE' }]}>{t.title}</Text>
                        <Text style={styles.trackArtist}>{t.artist}</Text>
                        {t.source === 'file' && selectedFileName && (
                          <Text style={{ fontSize: 11, color: '#34D399', marginTop: 3 }}>
                            ✓ Song selected: {selectedFileName}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.trackDuration}>{t.duration}</Text>
                    </TouchableOpacity>

                    {isSelected && t.source === 'file' && (
                      <TouchableOpacity
                        style={{
                          marginTop: 6,
                          backgroundColor: '#0E7490',
                          paddingVertical: 9,
                          paddingHorizontal: 14,
                          borderRadius: 8,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        onPress={async () => {
                          const picked = await NativeNetwork.pickAudioFile();
                          if (picked && picked.uri) {
                            setSelectedFileUri(picked.uri);
                            setSelectedFileName(picked.name);
            showToast(`Song loaded: ${picked.name}`, 'success');
                            if (isHostBroadcasting) {
                              NativeNetwork.playAudioFile(picked.uri).catch(() => {});
                            }
                          }
                        }}>
                        <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>
                          {selectedFileName ? `📂 Change song (${selectedFileName})` : '📂 Pick any song from storage'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}

              {/* Master Volume */}
              <View style={styles.volumeBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={styles.volLabel}>Master Stream Volume</Text>
                  <Text style={styles.volValue}>{masterVolume}%</Text>
                </View>
                <View style={styles.volControlRow}>
                  <TouchableOpacity
                    style={styles.volBtn}
                    onPress={() => {
                      const v = Math.max(0, masterVolume - 5);
                      setMasterVolume(v);
                      NativeNetwork.updateBroadcastState(isHostBroadcasting, activeTrack.title, v).catch(() => { });
                    }}>
                    <Text style={styles.volBtnText}>−</Text>
                  </TouchableOpacity>
                  <View style={styles.volTrack}>
                    <View style={[styles.volFill, { width: `${masterVolume}%`, backgroundColor: '#22D3EE' }]} />
                  </View>
                  <TouchableOpacity
                    style={styles.volBtn}
                    onPress={() => {
                      const v = Math.min(100, masterVolume + 5);
                      setMasterVolume(v);
                      NativeNetwork.updateBroadcastState(isHostBroadcasting, activeTrack.title, v).catch(() => { });
                    }}>
                    <Text style={styles.volBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAGE 2: 🎧 JOIN ROOM (REAL P2P LISTENER)
        ═══════════════════════════════════════════════════════════════════ */}
        {activePage === 'join' && (
          <View style={styles.pageContainer}>
            {joinedRoom ? (
              /* Already Joined View */
              <View style={[styles.card, { borderColor: '#34D399', backgroundColor: '#05100D' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <View style={styles.liveGreenDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.joinedTitle}>Connected to {joinedRoom.hostName}</Text>
                    <Text style={styles.joinedSub}>
                      Room code: {joinedRoom.code} • Host IP: {joinedRoom.hostIp}:8942
                    </Text>
                  </View>
                  <View style={styles.syncedBadge}>
                    <Text style={styles.syncedBadgeText}>● LIVE</Text>
                  </View>
                </View>

                {/* Live Participants Indicator */}
                <View style={styles.listenerStatusRow}>
                  <Text style={styles.listenerStatusText}>
                    👥 {joinedRoom.participantsCount} people active in this room
                  </Text>
                </View>

                {/* Audio Visualizer */}
                <View style={styles.listenerVisualizerBox}>
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim2 }], backgroundColor: '#34D399' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim4 }], backgroundColor: '#34D399' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim1 }], backgroundColor: '#34D399' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim3 }], backgroundColor: '#34D399' }]} />
                </View>

                {/* Personal Volume */}
                <View style={[styles.volumeBox, { marginTop: 14 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={styles.volLabel}>Personal Headphone Volume</Text>
                    <Text style={[styles.volValue, { color: '#34D399' }]}>{listenerVolume}%</Text>
                  </View>
                  <View style={styles.volControlRow}>
                    <TouchableOpacity
                      style={styles.volBtn}
                      onPress={() => setListenerVolume(v => Math.max(0, v - 5))}>
                      <Text style={styles.volBtnText}>−</Text>
                    </TouchableOpacity>
                    <View style={styles.volTrack}>
                      <View style={[styles.volFill, { width: `${listenerVolume}%`, backgroundColor: '#34D399' }]} />
                    </View>
                    <TouchableOpacity
                      style={styles.volBtn}
                      onPress={() => setListenerVolume(v => Math.min(100, v + 5))}>
                      <Text style={styles.volBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveRoom}>
                  <Text style={styles.leaveBtnText}>Leave room</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Join Form */
              <View style={styles.card}>
                <Text style={styles.cardBadge}>JOIN BROADCAST ROOM</Text>
                <Text style={styles.sectionTitle}>Join the host's room</Text>
                <Text style={styles.cardDesc}>
                  On the same Wi-Fi or offline hotspot? Tap a room below to join instantly:
                </Text>

                {/* ── Auto-Discovered Other Rooms on LAN ── */}
                {otherDiscoveredRooms.length > 0 && (
                  <View style={styles.discoveredContainer}>
                  <Text style={styles.discoveredHeader}>🌟 Active rooms found nearby:</Text>
                    {otherDiscoveredRooms.map((r, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.discoveredItem}
                        disabled={isJoining}
                        onPress={() => handleJoinHost(r.hostIp, r.port)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.discoveredTitle}>{r.hostName}</Text>
                          <Text style={styles.discoveredMeta}>
                            Code: #{r.roomCode} • IP: {r.hostIp}:{r.port}
                          </Text>
                        </View>
                        <View style={styles.quickJoinBtn}>
                          <Text style={styles.quickJoinBtnText}>Join ⚡</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* 4-Digit Room Code or Host IP Input */}
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.inputLabel}>Enter the host's 4-digit room code or IP:</Text>
                  <View style={styles.codeRow}>
                    <TextInput
                      style={[
                        styles.codeInput,
                        joinFeedback?.type === 'error' && { borderColor: '#F87171' },
                        joinFeedback?.type === 'warn' && { borderColor: '#FBBF24' },
                      ]}
                      placeholder="4-digit code (e.g. 8942)"
                      placeholderTextColor="#6B6B76"
                      value={inputRoomCode}
                      onChangeText={val => {
                        setInputRoomCode(val);
                        if (joinFeedback) setJoinFeedback(null);
                      }}
                      keyboardType="numeric"
                      maxLength={16}
                    />
                    <TouchableOpacity
                      style={styles.joinActionBtn}
                      disabled={isJoining}
                      onPress={handleManualJoin}>
                      {isJoining ? (
                        <ActivityIndicator color="#050811" size="small" />
                      ) : (
                        <Text style={styles.joinActionBtnText}>Join</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Professional In-Line Helper & Guidance Card */}
                  {joinFeedback && (
                    <View style={[styles.feedbackCard, joinFeedback.type === 'error' && { borderColor: '#F87171', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <Text style={{ fontSize: 14 }}>{joinFeedback.type === 'error' ? '🔐' : '💡'}</Text>
                        <Text style={[styles.feedbackTitle, joinFeedback.type === 'error' && { color: '#F87171' }]}>
                          {joinFeedback.type === 'error' ? 'Room code incorrect' : 'Check the code'}
                        </Text>
                      </View>
                      <Text style={styles.feedbackText}>{joinFeedback.message}</Text>
                      {joinFeedback.suggestedRoom && (
                        <TouchableOpacity
                          style={styles.suggestionBtn}
                          onPress={() => {
                            const sug = joinFeedback.suggestedRoom!;
                            setInputRoomCode(sug.roomCode);
                            setJoinFeedback(null);
                            handleJoinHost(sug.hostIp, sug.port, sug.roomCode);
                          }}>
                          <Text style={styles.suggestionBtnText}>
                            ⚡ Join {joinFeedback.suggestedRoom.hostName} (#{joinFeedback.suggestedRoom.roomCode})
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                {/* Divider */}
                <View style={styles.orDividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.orText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Real Camera QR Scanner Launcher */}
                <TouchableOpacity
                  style={styles.qrScanBtn}
                  onPress={handleOpenQrScanner}>
                  <Text style={{ fontSize: 22, marginRight: 8 }}>📷</Text>
                  <Text style={styles.qrScanBtnText}>Scan QR code with camera</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Quick Tips */}
            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>💡 How it works</Text>
              <Text style={styles.tipText}>
                1. Join the same offline hotspot or Wi-Fi as the host phone.{'\n'}
                2. Put on Bluetooth headphones or plug in earphones.{'\n'}
                3. Every song and voice from the host plays live in your headphones!
              </Text>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAGE: 🎬 MEDIA LIBRARY — every audio & video file on the device
        ═══════════════════════════════════════════════════════════════════ */}
        {activePage === 'media' && (
          <View style={styles.pageContainer}>
            {/* ── Library header: stats, search, tabs, room sync ── */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={styles.cardBadge}>ON-DEVICE LIBRARY</Text>
                  <Text style={styles.mediaLibTitle}>My media</Text>
                  <Text style={styles.mediaLibMeta}>
                    {audioCount} audio • {videoCount} video • {librarySizeLabel}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.mediaIconBtn}
                  onPress={() => loadDeviceMedia('all')}
                  disabled={isLoadingMedia}>
                  {isLoadingMedia ? (
                    <ActivityIndicator size="small" color="#22D3EE" />
                  ) : (
                    <Text style={{ fontSize: 16 }}>🔄</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.searchBox}>
                <Text style={{ fontSize: 14, marginRight: 8 }}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search songs, videos, albums or formats…"
                  placeholderTextColor="#6B6B76"
                  value={mediaSearch}
                  onChangeText={setMediaSearch}
                  returnKeyType="search"
                />
                {mediaSearch.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setMediaSearch('')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ color: '#6B6B76', fontSize: 14 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Live result count while searching — instant feedback that the filter worked. */}
              {mediaSearch.trim().length > 0 && (
                <Text style={styles.mediaSearchMeta}>
                  {sortedMedia.length === 0
                    ? `No matches for “${mediaSearch.trim()}”`
                    : `${sortedMedia.length} match${sortedMedia.length === 1 ? '' : 'es'} for “${mediaSearch.trim()}”`}
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  { key: 'all', label: 'All', icon: '🌟', count: mediaFiles.length },
                  { key: 'audio', label: 'Audio', icon: '🎵', count: audioCount },
                  { key: 'video', label: 'Video', icon: '🎬', count: videoCount },
                ] as Array<{ key: 'all' | 'audio' | 'video'; label: string; icon: string; count: number }>).map(tab => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.mediaTab, mediaCategory === tab.key && styles.mediaTabActive]}
                    onPress={() => {
                      setMediaCategory(tab.key);
                      setMediaRenderLimit(60);
                    }}>
                    <Text style={[styles.mediaTabText, mediaCategory === tab.key && styles.mediaTabTextActive]}>
                      {tab.icon} {tab.label}{tab.count > 0 ? ` ${tab.count}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity
                  style={[styles.mediaSyncToggle, broadcastToRoom && styles.mediaSyncToggleOn]}
                  onPress={toggleBroadcastToRoom}>
                  <Text
                    style={[
                      styles.mediaSyncToggleText,
                      broadcastToRoom && styles.mediaSyncToggleTextOn,
                    ]}>
                    {broadcastToRoom ? '📡 ROOM SYNC ON' : '🔕 ROOM SYNC OFF'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mediaOpenBtn} onPress={handlePickCustomMedia}>
                  <Text style={styles.mediaOpenBtnText}>📂 Open file</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Library list, grouped by day ── */}
            {isLoadingMedia && mediaFiles.length === 0 ? (
              <View style={styles.mediaLoadingBox}>
                <ActivityIndicator size="large" color="#22D3EE" />
                <Text style={styles.mediaLoadingText}>Scanning your device for audio and video…</Text>
              </View>
            ) : mediaGroups.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 34, marginBottom: 8 }}>📁</Text>
                <Text style={styles.emptyTitle}>No media found</Text>
                <Text style={styles.emptySub}>
                  {mediaSearch
                    ? 'Nothing matches that name. Try another title or format.'
                    : 'Grant media permission, or tap "Open file" to pick one directly.'}
                </Text>
                {!mediaSearch && (
                  <TouchableOpacity style={styles.mediaPermBtn} onPress={handleRequestMediaPermissions}>
                    <Text style={styles.mediaPermBtnText}>Grant media permission</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              mediaGroups.map(group => (
                <View key={group.key}>
                  <View style={styles.mediaGroupHeader}>
                    <Text style={styles.mediaGroupLabel}>{group.label}</Text>
                    <Text style={styles.mediaGroupCount}>{group.items.length}</Text>
                  </View>
                  {group.items.map(item => (
                    <MediaRow
                      key={item.id}
                      item={item}
                      active={currentMedia?.id === item.id}
                      playing={currentMedia?.id === item.id && isMediaPlaying}
                      onPress={() => handlePlayMedia(item)}
                    />
                  ))}
                </View>
              ))
            )}

            {sortedMedia.length > mediaRenderLimit && (
              <TouchableOpacity
                style={styles.mediaMoreBtn}
                onPress={() => setMediaRenderLimit(n => n + 100)}>
                <Text style={styles.mediaMoreBtnText}>
                  Show more • {sortedMedia.length - mediaRenderLimit} remaining
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAGE 3: 📻 WALKIE-TALKIE (UNIFIED ROOM VOICE - NO CHANNELS)
        ═══════════════════════════════════════════════════════════════════ */}
        {activePage === 'walkie' && (
          <View style={styles.pageContainer}>
            {/* Room Voice Info Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={styles.cardBadge}>OFFLINE ROOM WALKIE-TALKIE</Text>
                  <Text style={styles.roomVoiceTitle}>
                  Room #{joinedRoom ? joinedRoom.code : roomCode}
                  </Text>
                </View>
                <View style={styles.roomMemberBadge}>
                  <Text style={styles.roomMemberBadgeText}>
                    👥 {joinedRoom ? joinedRoom.participantsCount : connectedCount} connected
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDesc}>
                Everyone in this room can talk and listen together — no channel switching needed.
              </Text>

              {/* Live Speaker Transmission Bar */}
              <View
                style={[
                  styles.speakerBanner,
                  isTalking
                    ? styles.speakerBannerTalking
                    : activeSpeaker
                    ? styles.speakerBannerActive
                    : styles.speakerBannerIdle,
                ]}>
                <Text style={{ fontSize: 24, marginRight: 10 }}>
                  {isTalking ? '🎙️' : activeSpeaker ? '🔊' : '🟢'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.speakerBannerTitle,
                      isTalking && { color: '#F87171' },
                      activeSpeaker && !isTalking && { color: '#22D3EE' },
                    ]}>
                    {isTalking
                      ? `You are speaking (${networkInfo?.deviceName || 'This phone'})`
                      : activeSpeaker
                      ? `${activeSpeaker} is speaking…`
                      : 'Room ready • hold the button to talk'}
                  </Text>
                  <Text style={styles.speakerBannerSub}>
                    {isTalking
                      ? 'Everyone in the room is hearing you live'
                      : activeSpeaker
                      ? 'Everyone is listening to them now'
                      : 'Sound goes to every connected phone at once'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Noise cancellation panel */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Text style={{ fontSize: 17 }}>{noiseCancelOn ? '🔇' : '🔊'}</Text>
                  <View>
                    <Text style={styles.sectionTitle}>Voice clarity</Text>
                    <Text style={styles.noiseSubtitle}>
                      {noiseCancelOn
                        ? 'Background noise is removed before it is sent'
                        : 'Raw microphone — background noise is passed through'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.noiseToggle, noiseCancelOn && styles.noiseToggleOn]}
                  onPress={toggleNoiseCancellation}>
                  <Text style={[styles.noiseToggleText, noiseCancelOn && styles.noiseToggleTextOn]}>
                    {noiseCancelOn ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              </View>

              {noiseCancelOn && (
                <>
                  <View style={styles.noiseLevelRow}>
                    <Text style={styles.volLabel}>Strength</Text>
                    <Text style={styles.volValue}>
                      {noiseStrength < 0.5 ? 'Light' : noiseStrength < 0.85 ? 'Balanced' : 'Aggressive'}
                    </Text>
                  </View>
                  <View style={styles.noisePresetRow}>
                    {[
                      { key: 0.4, label: 'Light' },
                      { key: 0.75, label: 'Balanced' },
                      { key: 1.0, label: 'Max' },
                    ].map(p => (
                      <TouchableOpacity
                        key={p.key}
                        style={[styles.noisePreset, Math.abs(noiseStrength - p.key) < 0.01 && styles.noisePresetActive]}
                        onPress={() => changeNoiseStrength(p.key)}>
                        <Text
                          style={[
                            styles.noisePresetText,
                            Math.abs(noiseStrength - p.key) < 0.01 && styles.noisePresetTextActive,
                          ]}>
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Live suppression meter, fed by the native DSP */}
                  <View style={styles.noiseMeterBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.noiseMeterLabel}>Noise removed</Text>
                      <Text style={styles.noiseMeterValue}>
                        {noiseStats && isTalking
                          ? `${Math.abs(noiseStats.reductionDb).toFixed(1)} dB`
                          : '—'}
                      </Text>
                    </View>
                    <View style={styles.noiseMeterTrack}>
                      <View
                        style={[
                          styles.noiseMeterFill,
                          { width: `${Math.round((noiseStats?.reductionRatio ?? 0) * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.noiseMeterHint}>
                      {isTalking
                        ? 'Listening — figures update live while you hold the button'
                        : 'Hold the talk button to see live noise reduction'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Giant Push-To-Talk Button */}
            <View style={styles.pttContainer}>
              <Animated.View
                style={[
                  styles.pttOuterRing,
                  isTalking && styles.pttOuterRingActive,
                  { transform: [{ scale: pttPulse }] },
                ]}>
                <TouchableOpacity
                  style={[styles.pttButton, isTalking && styles.pttButtonActive]}
                  activeOpacity={0.85}
                  onPressIn={handlePttPressIn}
                  onPressOut={handlePttPressOut}>
                  <Text style={styles.pttIcon}>{isTalking ? '🎙️' : '📻'}</Text>
                  <Text style={styles.pttText}>{isTalking ? 'TRANSMITTING' : 'HOLD TO TALK'}</Text>
                  <Text style={styles.pttSubtext}>{isTalking ? 'Release to stop' : 'Live to the room'}</Text>
                </TouchableOpacity>
              </Animated.View>

              {/* Speaker Phone Name Display */}
              <View style={styles.speakerStatusBox}>
                <View
                  style={[
                    styles.activeSpeakerDot,
                    { backgroundColor: isTalking ? '#F87171' : activeSpeaker ? '#22D3EE' : '#34D399' },
                  ]}
                />
                <Text style={styles.speakerStatusText}>
                  {isTalking
                    ? `Microphone active: ${networkInfo?.deviceName || 'This phone'}`
                    : activeSpeaker
                    ? `Speaking: ${activeSpeaker}`
                    : 'Room ready • hold the button to talk'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            PAGE 4: 📱 BLUETOOTH DEVICES (HARDWARE & SMART 10S SCANNER)
        ═══════════════════════════════════════════════════════════════════ */}
        {activePage === 'devices' && (
          <View style={styles.pageContainer}>
            {/* Battery Safe Scanner Card */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <View>
                  <Text style={styles.cardBadge}>HARDWARE BLE MANAGER</Text>
                  <Text style={styles.sectionTitle}>Nearby Devices ({filteredDevices.length})</Text>
                </View>

                {/* On-demand Smart 10s Scan Button */}
                <TouchableOpacity
                  style={[styles.scanBtn, isScanning && styles.scanBtnActive]}
                  onPress={handleStartScan}
                  disabled={isScanning}>
                  {isScanning ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={styles.scanBtnText}>Scanning ({scanCountdown}s)...</Text>
                    </View>
                  ) : (
                    <Text style={styles.scanBtnText}>🔍 Scan Nearby</Text>
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.cardDesc}>
                Smart on-demand scanner: it does not scan constantly, which saves battery. Tap the button and it scans for 10 seconds, then switches itself off.
              </Text>

              {/* Search Box */}
              <View style={styles.searchBox}>
                <Text style={{ fontSize: 14, marginRight: 8 }}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search device name or MAC address..."
                  placeholderTextColor="#6B6B76"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              {/* Filter Pills */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {(['All', 'Connected', 'Paired', 'Audio', 'Wearables'] as FilterTab[]).map(tab => (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.filterPill, selectedFilter === tab && styles.filterPillActive]}
                    onPress={() => setSelectedFilter(tab)}>
                    <Text style={[styles.filterPillText, selectedFilter === tab && styles.filterPillTextActive]}>
                      {tab}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Discovered Device Cards */}
            {filteredDevices.map(dev => {
              const sig = getSignalInfo(dev.rssi);
              const isConn = dev.status === 'Connected' || dev.status === 'Broadcasting';

              return (
                <View
                  key={dev.id}
                  style={[styles.deviceCard, isConn && { borderColor: '#34D399', borderWidth: 1.5 }]}>
                  <View style={styles.deviceCardTop}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={styles.deviceName} numberOfLines={1}>
                          {dev.name}
                        </Text>
                        {dev.battery !== undefined && (
                          <View style={styles.battBadge}>
                            <Text style={styles.battText}>🔋 {dev.battery}%</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.deviceMeta}>
                        {dev.type} • {dev.macAddress}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <Text style={[styles.signalDots, { color: sig.color }]}>{sig.dots}</Text>
                        <Text style={[styles.signalText, { color: sig.color }]}>
                          {dev.rssi} dBm ({sig.label})
                        </Text>
                      </View>
                    </View>

                    {/* Action Button */}
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      {isConn ? (
                        <TouchableOpacity
                          style={styles.disconnectBtn}
                          onPress={() => handleDisconnectDevice(dev)}>
                          <Text style={styles.disconnectBtnText}>Disconnect</Text>
                        </TouchableOpacity>
                      ) : dev.status === 'Connecting' ? (
                        <View style={styles.connectingBox}>
                          <ActivityIndicator size="small" color="#fff" />
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.connectBtn}
                          onPress={() => handleConnectDevice(dev)}>
                          <Text style={styles.connectBtnText}>Connect</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}

            {filteredDevices.length === 0 && (
              <View style={styles.emptyCard}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>🎧</Text>
                <Text style={styles.emptyTitle}>No Devices Found</Text>
                <Text style={styles.emptySub}>
                  Put your headphones in pairing mode, then tap &quot;Scan nearby&quot; above.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Futuristic Bottom Navigation Bar ── */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navItem, activePage === 'host' && styles.navItemActive]}
          onPress={() => setActivePage('host')}>
          <Text style={[styles.navIcon, activePage === 'host' && styles.navIconActive]}>📡</Text>
          <Text style={[styles.navLabel, activePage === 'host' && styles.navLabelActive]}>Host</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'join' && styles.navItemActive]}
          onPress={() => setActivePage('join')}>
          <Text style={[styles.navIcon, activePage === 'join' && styles.navIconActive]}>🎧</Text>
          <Text style={[styles.navLabel, activePage === 'join' && styles.navLabelActive]}>Join</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'media' && styles.navItemActive]}
          onPress={() => setActivePage('media')}>
          <Text style={[styles.navIcon, activePage === 'media' && styles.navIconActive]}>🎬</Text>
          <Text style={[styles.navLabel, activePage === 'media' && styles.navLabelActive]}>Media</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'walkie' && styles.navItemActive]}
          onPress={() => setActivePage('walkie')}>
          <Text style={[styles.navIcon, activePage === 'walkie' && styles.navIconActive]}>📻</Text>
          <Text style={[styles.navLabel, activePage === 'walkie' && styles.navLabelActive]}>Walkie</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'devices' && styles.navItemActive]}
          onPress={() => setActivePage('devices')}>
          <Text style={[styles.navIcon, activePage === 'devices' && styles.navIconActive]}>📱</Text>
          <Text style={[styles.navLabel, activePage === 'devices' && styles.navLabelActive]}>Devices</Text>
        </TouchableOpacity>
      </View>

      {/* ── QR Scanner & Quick Join Modal ── */}
      <Modal visible={showQRScanner} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.qrModalCard}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📷</Text>
            <Text style={styles.modalTitle}>QR Code & Quick Join</Text>
            <Text style={styles.modalSub}>Enter the host's IP address, or tap a discovered room</Text>

            {otherDiscoveredRooms.length > 0 && (
              <View style={{ width: '100%', marginBottom: 14 }}>
                <Text style={{ color: '#22D3EE', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
              <Text style={styles.inputLabel}>Active rooms found nearby:</Text>
                </Text>
                {otherDiscoveredRooms.map((r, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.modalRoomPill}
                    onPress={() => {
                      setShowQRScanner(false);
                      handleJoinHost(r.hostIp, r.port);
                    }}>
                    <Text style={styles.modalRoomPillText}>
                      ⚡ {r.hostName} (#{r.roomCode} @ {r.hostIp})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <TextInput
              style={styles.modalIpInput}
              placeholder="4-digit room code (e.g. 8942) or IP"
              placeholderTextColor="#6B6B76"
              value={inputRoomCode || inputHostIp}
              onChangeText={val => {
                setInputRoomCode(val);
                setInputHostIp(val);
              }}
              keyboardType="numbers-and-punctuation"
            />

            <TouchableOpacity
              style={styles.modalActionBtn}
              onPress={() => {
                setShowQRScanner(false);
                handleManualJoin();
              }}>
              <Text style={styles.modalActionBtnText}>⚡ Join host room</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowQRScanner(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Floating mini player (visible on every page while media is loaded) ── */}
      {currentMedia && !showPlayer && !showFullscreen && (
        <TouchableOpacity
          style={styles.miniPlayer}
          activeOpacity={0.92}
          onPress={() => {
            if (currentMedia.type === 'video') {
              setShowFullscreen(true);
              setShowPlayer(false);
            } else {
              setShowPlayer(true);
            }
          }}>
          <MediaArt uri={currentMedia.albumArt} type={currentMedia.type} size={40} radius={8} />
          <View style={{ flex: 1, marginLeft: 10, marginRight: 8 }}>
            <Text style={styles.miniTitle} numberOfLines={1}>
              {currentMedia.title}
            </Text>
            <Text style={styles.miniSub} numberOfLines={1}>
              {formatDurationMs(playbackPos * 1000)} / {formatDurationMs(playbackDur * 1000)}
              {broadcastToRoom ? ' • 📡 LIVE' : ''}
            </Text>
            <View style={styles.miniProgressTrack}>
              <View
                style={[
                  styles.miniProgressFill,
                  {
                    width:
                      playbackDur > 0
                        ? `${Math.min(100, Math.max(0, (playbackPos / playbackDur) * 100))}%`
                        : '0%',
                  },
                ]}
              />
            </View>
          </View>
          <TouchableOpacity
            style={styles.miniBtn}
            onPress={handleTogglePlayPause}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Text style={styles.miniBtnText}>{isMediaPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.miniBtn}
            onPress={handleStopMedia}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Text style={[styles.miniBtnText, { color: '#F87171' }]}>✕</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      <NowPlayingSheet
        visible={showPlayer}
        item={currentMedia}
        isPlaying={isMediaPlaying}
        position={playbackPos}
        duration={playbackDur}
        error={mediaError}
        broadcastToRoom={broadcastToRoom}
        shuffle={isShuffle}
        onClose={() => setShowPlayer(false)}
        onToggle={handleTogglePlayPause}
        onSeek={handleSeek}
        onNext={() => handleNextMedia(1)}
        onPrev={() => handleNextMedia(-1)}
        onStop={handleStopMedia}
        onToggleBroadcast={toggleBroadcastToRoom}
        onToggleShuffle={() => setIsShuffle(v => !v)}
        onOpenExternal={handleOpenExternal}
        onOpenFullscreen={() => {
          // Hide the bottom sheet first: it is a Modal, so it renders in a
          // portal ABOVE anything inside #root, and its <video> would keep
          // playing audio underneath the fullscreen player.
          setShowPlayer(false);
          setShowFullscreen(true);
        }}
      />

      <Modal
        visible={showFullscreen && !!currentMedia && currentMedia.type === 'video'}
        transparent={false}
        statusBarTranslucent={true}
        animationType="fade"
        presentationStyle="fullScreen"
        supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={() => setShowFullscreen(false)}>
        <FullscreenPlayer
          visible={showFullscreen && !!currentMedia && currentMedia.type === 'video'}
          title={currentMedia?.title || ''}
          subtitle={
            currentMedia
              ? `${currentMedia.format}${currentMedia.size ? ' • ' + currentMedia.size : ''}`
              : undefined
          }
          uri={currentMedia ? webMediaUri(currentMedia.uri) : ''}
          audioUri={currentMedia ? webMediaAudio(currentMedia.uri) : undefined}
          isPlaying={isMediaPlaying}
          position={playbackPos}
          duration={playbackDur}
          onClose={() => {
            setShowFullscreen(false);
          }}
          onTogglePlay={handleTogglePlayPause}
          onSeek={handleSeek}
          onNext={() => handleNextMedia(1)}
          onPrev={() => handleNextMedia(-1)}
          onEnded={() => handleNextMedia(1)}
          hasNext={sortedMedia.length > 1}
          hasPrev={sortedMedia.length > 1}
        />
      </Modal>
    </SafeAreaView>
  );
}

// ─── Design tokens ───────────────────────────────────────────────────────────
// True-black canvas, layered neutral surfaces, hairline borders and a single
// cyan accent. Numbers use tabular figures so timers don't jitter.
const C = {
  bg: '#000000',
  surf: '#0A0A0E',
  surf2: '#101017',
  surf3: '#17171F',
  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.14)',
  text: '#FAFAFA',
  textDim: '#A1A1AA',
  textMute: '#6B6B76',
  accent: '#22D3EE',
  accentDeep: '#0891B2',
  green: '#34D399',
  red: '#F87171',
  amber: '#FBBF24',
};

const SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.55,
  shadowRadius: 24,
  elevation: 10,
};

const GLOW = {
  shadowColor: C.accent,
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.4,
  shadowRadius: 18,
  elevation: 8,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  scrollBody: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  pageContainer: {
    gap: 16,
    paddingTop: 8,
  },

  // ── Toast ──────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    zIndex: 9999,
    backgroundColor: C.surf3,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.lineStrong,
    ...SHADOW,
  },
  toastSuccess: { backgroundColor: '#052E22', borderColor: C.green },
  toastError: { backgroundColor: '#3A1214', borderColor: C.red },
  toastWarn: { backgroundColor: '#3A2A08', borderColor: C.amber },
  toastText: {
    color: C.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    backgroundColor: C.bg,
  },
  appTitle: {
    fontSize: 21,
    fontWeight: '900',
    color: C.text,
    letterSpacing: 1.5,
  },
  proPill: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
  },
  proPillText: {
    color: C.accent,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subTitle: {
    color: C.textMute,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
    letterSpacing: 0.2,
  },
  netBadge: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  netBadgeOn: {
    backgroundColor: 'rgba(52,211,153,0.1)',
    borderColor: 'rgba(52,211,153,0.5)',
  },
  netBadgeOff: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderColor: 'rgba(248,113,113,0.5)',
  },
  netBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  netBadgeTextOn: { color: C.green },
  netBadgeTextOff: { color: C.red },

  // ── Network warning ────────────────────────────────────────────────────────
  netWarningBox: {
    backgroundColor: 'rgba(251,191,36,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    borderRadius: 18,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
  },
  netWarningTitle: {
    color: C.amber,
    fontSize: 14,
    fontWeight: '800',
  },
  netWarningText: {
    color: C.textDim,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 6,
  },
  netActionBtn: {
    backgroundColor: C.amber,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 10,
  },
  netActionBtnText: {
    color: '#1A1200',
    fontSize: 12,
    fontWeight: '800',
  },

  // ── Network strip ──────────────────────────────────────────────────────────
  netStatusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: C.surf,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  netStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.green,
  },
  netStatusText: {
    color: C.accent,
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.2,
  },
  netDeviceName: {
    color: C.textMute,
    fontSize: 11,
  },

  // ── Cards ──────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: C.surf,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: C.line,
    ...SHADOW,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardBadge: {
    color: C.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  cardDesc: {
    color: C.textDim,
    fontSize: 12.5,
    lineHeight: 19,
    marginBottom: 12,
  },
  cardCtaText: {
    color: '#00212B',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  cardCta: {
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 11,
    ...GLOW,
  },
  cardIconTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowStreamingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
  },
  nowStreamingLabel: {
    color: C.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  nowStreamingTitle: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 3,
  },
  nowStreamingTime: {
    color: C.textMute,
    fontSize: 10.5,
    fontFamily: 'monospace',
    marginTop: 3,
  },
  nowStreamingBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowStreamingBtnText: {
    color: '#00212B',
    fontSize: 12,
    fontWeight: '900',
  },
  nowStreamingStopBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(248,113,113,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowStreamingStopText: {
    color: C.red,
    fontSize: 12,
    fontWeight: '900',
  },

  // ── Host room ──────────────────────────────────────────────────────────────
  roomCodeTitle: {
    color: C.text,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 7,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  regenBtn: {
    backgroundColor: 'rgba(34,211,238,0.1)',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
  },
  regenBtnText: {
    color: C.accent,
    fontSize: 11.5,
    fontWeight: '800',
  },
  qrHint: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
  },
  qrSubHint: {
    color: C.textMute,
    fontSize: 10.5,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  listenerCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: C.surf2,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.line,
  },
  listenerNumberBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenerNumber: {
    color: C.accent,
    fontSize: 20,
    fontWeight: '900',
  },
  listenerTitle: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  listenerSub: {
    color: C.textMute,
    fontSize: 11,
    marginTop: 2,
  },
  liveTimerBadge: {
    backgroundColor: 'rgba(248,113,113,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.5)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveTimerText: {
    color: C.red,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  startBtn: {
    backgroundColor: C.accent,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    ...GLOW,
  },
  startBtnText: {
    color: '#00212B',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  stopBtn: {
    backgroundColor: 'rgba(248,113,113,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.5)',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
  },
  stopBtnText: {
    color: C.red,
    fontSize: 14,
    fontWeight: '800',
  },

  // ── Participants ───────────────────────────────────────────────────────────
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surf2,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 8,
  },
  participantName: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  participantMeta: {
    color: C.textMute,
    fontSize: 10.5,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  hostBadge: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  hostBadgeText: {
    color: C.accent,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  syncedBadge: {
    backgroundColor: 'rgba(52,211,153,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.4)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  syncedBadgeText: {
    color: C.green,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  noParticipantsBox: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  noParticipantsText: {
    color: C.textMute,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Visualizer ─────────────────────────────────────────────────────────────
  visualizerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 20,
  },
  visualizerBar: {
    width: 3,
    height: 18,
    backgroundColor: C.accent,
    borderRadius: 2,
  },

  // ── Section + tracks ───────────────────────────────────────────────────────
  sectionTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 8,
  },
  trackItemActive: {
    borderColor: 'rgba(34,211,238,0.6)',
    backgroundColor: 'rgba(34,211,238,0.08)',
  },
  trackTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '700',
  },
  trackArtist: {
    color: C.textMute,
    fontSize: 11,
    marginTop: 2,
  },
  trackDuration: {
    color: C.textDim,
    fontSize: 10.5,
    fontFamily: 'monospace',
  },

  // ── Volume ─────────────────────────────────────────────────────────────────
  volumeBox: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
  volLabel: {
    color: C.textDim,
    fontSize: 11.5,
    fontWeight: '600',
  },
  volValue: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  volControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  volBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volBtnText: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
  },
  volTrack: {
    flex: 1,
    height: 6,
    backgroundColor: C.surf3,
    borderRadius: 3,
    overflow: 'hidden',
  },
  volFill: {
    height: '100%',
  },

  // ── Join room ──────────────────────────────────────────────────────────────
  liveGreenDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: C.green,
  },
  joinedTitle: {
    color: C.green,
    fontSize: 16,
    fontWeight: '800',
  },
  joinedSub: {
    color: C.textDim,
    fontSize: 11,
    marginTop: 3,
    fontFamily: 'monospace',
  },
  listenerStatusRow: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.25)',
    padding: 10,
    marginVertical: 12,
  },
  listenerStatusText: {
    color: C.green,
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  listenerVisualizerBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 7,
    height: 38,
    backgroundColor: '#04120E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.2)',
    padding: 8,
  },
  leaveBtn: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  leaveBtnText: {
    color: C.red,
    fontSize: 13,
    fontWeight: '800',
  },

  // ── Discovered rooms ───────────────────────────────────────────────────────
  discoveredContainer: {
    backgroundColor: C.surf2,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    marginBottom: 12,
  },
  discoveredHeader: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  discoveredItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surf3,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 7,
  },
  discoveredTitle: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  discoveredMeta: {
    color: C.textMute,
    fontSize: 10.5,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  quickJoinBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9,
  },
  quickJoinBtnText: {
    color: '#00212B',
    fontSize: 11.5,
    fontWeight: '800',
  },

  // ── Inputs ─────────────────────────────────────────────────────────────────
  inputLabel: {
    color: C.textDim,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    backgroundColor: C.surf2,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.line,
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  joinActionBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 20,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    ...GLOW,
  },
  joinActionBtnText: {
    color: '#00212B',
    fontSize: 13,
    fontWeight: '800',
  },
  feedbackCard: {
    backgroundColor: 'rgba(251,191,36,0.07)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    padding: 13,
    marginTop: 12,
  },
  feedbackTitle: {
    color: C.amber,
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 3,
  },
  feedbackText: {
    color: C.textDim,
    fontSize: 12,
    lineHeight: 18,
  },
  suggestionBtn: {
    backgroundColor: C.accent,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
  },
  suggestionBtnText: {
    color: '#00212B',
    fontSize: 12,
    fontWeight: '800',
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.line,
  },
  orText: {
    color: C.textMute,
    fontSize: 11,
    marginHorizontal: 14,
    fontWeight: '600',
  },
  qrScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.4)',
    paddingVertical: 14,
    borderRadius: 14,
  },
  qrScanBtnText: {
    color: C.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  tipBox: {
    backgroundColor: C.surf,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 14,
  },
  tipTitle: {
    color: C.accent,
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 6,
  },
  tipText: {
    color: C.textDim,
    fontSize: 11.5,
    lineHeight: 19,
  },

  // ── Noise cancellation ─────────────────────────────────────────────────────
  noiseSubtitle: {
    color: C.textMute,
    fontSize: 10.5,
    marginTop: 3,
    lineHeight: 14,
    maxWidth: 210,
  },
  noiseToggle: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
  },
  noiseToggleOn: {
    backgroundColor: 'rgba(52,211,153,0.14)',
    borderColor: 'rgba(52,211,153,0.5)',
  },
  noiseToggleText: {
    color: C.textMute,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  noiseToggleTextOn: {
    color: C.green,
  },
  noiseLevelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  noisePresetRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noisePreset: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
  },
  noisePresetActive: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: 'rgba(34,211,238,0.55)',
  },
  noisePresetText: {
    color: C.textMute,
    fontSize: 11,
    fontWeight: '700',
  },
  noisePresetTextActive: {
    color: C.accent,
    fontWeight: '800',
  },
  noiseMeterBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
  },
  noiseMeterLabel: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  noiseMeterValue: {
    color: C.green,
    fontSize: 11.5,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  noiseMeterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: C.surf3,
    overflow: 'hidden',
  },
  noiseMeterFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: C.green,
  },
  noiseMeterHint: {
    color: C.textMute,
    fontSize: 9.5,
    marginTop: 7,
    lineHeight: 13,
  },

  // ── Walkie-talkie ──────────────────────────────────────────────────────────
  roomVoiceTitle: {
    color: C.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  roomMemberBadge: {
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  roomMemberBadgeText: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  speakerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  speakerBannerIdle: {
    backgroundColor: C.surf2,
    borderColor: C.line,
  },
  speakerBannerTalking: {
    backgroundColor: 'rgba(248,113,113,0.09)',
    borderColor: 'rgba(248,113,113,0.45)',
  },
  speakerBannerActive: {
    backgroundColor: 'rgba(34,211,238,0.09)',
    borderColor: 'rgba(34,211,238,0.45)',
  },
  speakerBannerTitle: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '800',
  },
  speakerBannerSub: {
    color: C.textDim,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },
  pttContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  pttOuterRing: {
    width: 208,
    height: 208,
    borderRadius: 104,
    backgroundColor: 'rgba(34,211,238,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pttOuterRingActive: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderColor: 'rgba(248,113,113,0.4)',
  },
  pttButton: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor: C.surf2,
    borderWidth: 2,
    borderColor: 'rgba(34,211,238,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    ...GLOW,
  },
  pttButtonActive: {
    backgroundColor: '#3A1214',
    borderColor: C.red,
  },
  pttIcon: {
    fontSize: 38,
    marginBottom: 6,
  },
  pttText: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  pttSubtext: {
    color: C.textMute,
    fontSize: 10.5,
    marginTop: 3,
  },
  speakerStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 22,
    backgroundColor: C.surf,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
  },
  activeSpeakerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  speakerStatusText: {
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Bluetooth ──────────────────────────────────────────────────────────────
  scanBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 10,
  },
  scanBtnActive: {
    backgroundColor: C.textMute,
  },
  scanBtnText: {
    color: '#00212B',
    fontSize: 11.5,
    fontWeight: '800',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surf2,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 12.5,
    padding: 0,
  },
  filterPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
  },
  filterPillActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  filterPillText: {
    color: C.textDim,
    fontSize: 11.5,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#00212B',
    fontWeight: '800',
  },
  deviceCard: {
    backgroundColor: C.surf,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.line,
    ...SHADOW,
  },
  deviceCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  deviceName: {
    color: C.text,
    fontSize: 14.5,
    fontWeight: '700',
  },
  battBadge: {
    backgroundColor: 'rgba(52,211,153,0.1)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
  },
  battText: {
    color: C.green,
    fontSize: 10.5,
    fontWeight: '700',
  },
  deviceMeta: {
    color: C.textMute,
    fontSize: 11.5,
    marginTop: 3,
  },
  signalDots: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '800',
  },
  signalText: {
    fontSize: 11,
    fontWeight: '600',
  },
  connectBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 10,
    ...GLOW,
  },
  connectBtnText: {
    color: '#00212B',
    fontSize: 12,
    fontWeight: '800',
  },
  connectingBox: {
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  disconnectBtn: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.45)',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 10,
  },
  disconnectBtnText: {
    color: C.red,
    fontSize: 11.5,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: C.surf,
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.line,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5,
  },
  emptySub: {
    color: C.textMute,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Bottom navigation ──────────────────────────────────────────────────────
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 74,
    backgroundColor: C.surf,
    borderTopWidth: 1,
    borderTopColor: C.line,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingBottom: 8,
    alignItems: 'center',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 14,
  },
  navItemActive: {
    backgroundColor: 'rgba(34,211,238,0.08)',
  },
  navIcon: {
    fontSize: 19,
    opacity: 0.42,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    fontSize: 9.5,
    color: C.textMute,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0.2,
  },
  navLabelActive: {
    color: C.accent,
    fontWeight: '800',
  },

  // ── QR modal ───────────────────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: C.surf,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.lineStrong,
    ...SHADOW,
  },
  modalTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 5,
  },
  modalSub: {
    color: C.textDim,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  modalRoomPill: {
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  modalRoomPillText: {
    color: C.accent,
    fontSize: 12.5,
    fontWeight: '700',
  },
  modalIpInput: {
    width: '100%',
    backgroundColor: C.surf2,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.line,
    color: C.text,
    fontSize: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginBottom: 16,
    fontFamily: 'monospace',
    textAlign: 'center',
    letterSpacing: 1.2,
  },
  modalActionBtn: {
    width: '100%',
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    marginBottom: 10,
    ...GLOW,
  },
  modalActionBtnText: {
    color: '#00212B',
    fontSize: 13.5,
    fontWeight: '800',
  },
  modalCloseBtn: {
    paddingVertical: 9,
  },
  modalCloseBtnText: {
    color: C.textMute,
    fontSize: 12.5,
    fontWeight: '600',
  },

  // ── Media library ──────────────────────────────────────────────────────────
  mediaLibTitle: {
    color: C.text,
    fontSize: 21,
    fontWeight: '900',
    marginTop: 3,
    letterSpacing: -0.2,
  },
  mediaLibMeta: {
    color: C.textMute,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
    letterSpacing: 0.2,
  },
  mediaIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
  },
  mediaTabActive: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: 'rgba(34,211,238,0.55)',
  },
  mediaTabText: {
    color: C.textDim,
    fontSize: 11.5,
    fontWeight: '700',
  },
  mediaTabTextActive: {
    color: C.accent,
    fontWeight: '800',
  },
  mediaSyncToggle: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.surf2,
    borderWidth: 1,
    // C.line is 7% white, which disappears on the true-black canvas — the button
    // read as an unlabelled dark slab. A visible outline makes it obviously a
    // control, and the ON state then shifts hue rather than just brightening.
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaSyncToggleOn: {
    backgroundColor: 'rgba(52,211,153,0.16)',
    borderColor: 'rgba(52,211,153,0.62)',
  },
  mediaSyncToggleText: {
    // Was C.textMute (#6B6B76, 3.60:1) which read as a blank dark block. The
    // OFF state is the default, so it has to be legible without being read as
    // "disabled"; body-text contrast is the floor.
    color: C.textDim,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  mediaSyncToggleTextOn: {
    // The previous inline override used #00212B (dark ink) on a 16% green tint,
    // which measured 1.13:1 — effectively invisible. Dark ink only works on a
    // FILLED accent button (see mediaOpenBtn); on a tinted one it must be the
    // accent colour itself.
    color: C.green,
  },
  mediaOpenBtn: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...GLOW,
  },
  mediaOpenBtnText: {
    color: '#00212B',
    fontSize: 11.5,
    fontWeight: '800',
  },
  mediaLoadingBox: {
    paddingVertical: 38,
    alignItems: 'center',
  },
  mediaLoadingText: {
    color: C.textDim,
    fontSize: 12.5,
    marginTop: 12,
  },
  mediaPermBtn: {
    marginTop: 14,
    backgroundColor: C.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 11,
  },
  mediaPermBtnText: {
    color: '#00212B',
    fontSize: 12.5,
    fontWeight: '800',
  },
  mediaSearchMeta: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '700',
    marginTop: -2,
    marginBottom: 4,
  },
  mediaGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 14,
    paddingBottom: 8,
  },
  mediaGroupLabel: {
    color: C.textDim,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  mediaGroupCount: {
    color: C.textMute,
    fontSize: 10.5,
    fontWeight: '700',
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surf,
    borderRadius: 16,
    padding: 11,
    marginBottom: 7,
    borderWidth: 1,
    borderColor: C.line,
  },
  mediaRowActive: {
    borderColor: 'rgba(34,211,238,0.55)',
    backgroundColor: 'rgba(34,211,238,0.06)',
  },
  mediaRowTitle: {
    color: C.text,
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  mediaRowMeta: {
    color: C.textMute,
    fontSize: 10.5,
    marginTop: 3,
  },
  mediaFmtBadge: {
    backgroundColor: 'rgba(34,211,238,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.28)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  mediaFmtBadgeText: {
    color: C.accent,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  mediaExtBadge: {
    backgroundColor: 'rgba(251,191,36,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  mediaExtBadgeText: {
    color: C.amber,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  mediaRowDuration: {
    color: C.textDim,
    fontSize: 10.5,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  mediaPlayPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(34,211,238,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaPlayPillActive: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  // The glyph must flip with the background. On the idle pill the background is
  // a 14% cyan tint over the dark row, so a dark glyph was invisible (1.02:1
  // contrast). Idle therefore uses the bright accent, and only the filled green
  // state uses dark ink.
  mediaPlayPillText: {
    color: C.accent,
    fontSize: 11,
    fontWeight: '900',
  },
  mediaPlayPillTextActive: {
    color: '#00212B',
  },
  mediaMoreBtn: {
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
  },
  mediaMoreBtnText: {
    color: C.accent,
    fontSize: 12,
    fontWeight: '800',
  },

  // ── Player sheet ───────────────────────────────────────────────────────────
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.86)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surf,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: C.lineStrong,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: 'center',
    ...SHADOW,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.lineStrong,
    marginBottom: 12,
  },
  sheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 12,
  },
  sheetBadge: {
    color: C.accent,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  sheetClose: {
    color: C.textMute,
    fontSize: 16,
    fontWeight: '700',
  },
  videoSurface: {
    width: '100%',
    height: 208,
    backgroundColor: '#000000',
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.line,
  },
  fullscreenPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderColor: 'rgba(34,211,238,0.5)',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  fullscreenPillText: {
    color: C.accent,
    fontSize: 10.5,
    fontWeight: '700',
  },
  videoPoster: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: C.surf2,
  },
  videoPosterIcon: {
    fontSize: 38,
    marginBottom: 8,
  },
  videoPosterTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  videoPosterHint: {
    color: C.textMute,
    fontSize: 10.5,
    marginTop: 5,
    textAlign: 'center',
  },
  sheetTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 14,
    letterSpacing: -0.2,
  },
  sheetArtist: {
    color: C.textMute,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 8,
  },
  mediaErrorBox: {
    width: '100%',
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.4)',
    borderRadius: 13,
    padding: 12,
    marginTop: 10,
  },
  mediaErrorText: {
    color: '#FECACA',
    fontSize: 11.5,
    marginBottom: 8,
    lineHeight: 17,
  },
  mediaErrorBtn: {
    backgroundColor: C.red,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
  },
  mediaErrorBtnText: {
    color: '#2A0808',
    fontSize: 11.5,
    fontWeight: '800',
  },
  seekBarHit: {
    width: '100%',
    height: 30,
    justifyContent: 'center',
    marginTop: 12,
  },
  seekTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surf3,
    overflow: 'hidden',
  },
  seekFill: {
    height: '100%',
    backgroundColor: C.accent,
    borderRadius: 2,
  },
  seekKnob: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: C.accent,
    borderWidth: 2,
    borderColor: C.bg,
    shadowColor: C.accent,
    shadowOpacity: 0.8,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  sheetTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 4,
  },
  sheetTime: {
    color: C.textMute,
    fontSize: 10.5,
    fontFamily: 'monospace',
  },
  sheetControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 18,
  },
  sheetSideBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSideBtnText: {
    color: C.text,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetSkipBtn: {
    width: 46,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surf3,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSkipText: {
    color: C.textDim,
    fontSize: 11,
    fontWeight: '800',
  },
  sheetPlayBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...GLOW,
  },
  sheetPlayText: {
    color: '#00212B',
    fontSize: 24,
    fontWeight: '900',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 9,
    width: '100%',
    marginTop: 20,
  },
  sheetChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.surf2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: 'center',
  },
  sheetChipOn: {
    backgroundColor: 'rgba(34,211,238,0.12)',
    borderColor: 'rgba(34,211,238,0.5)',
  },
  sheetChipText: {
    color: C.textMute,
    fontSize: 10.5,
    fontWeight: '700',
  },
  sheetChipTextOn: {
    color: C.accent,
  },

  // ── Mini player ────────────────────────────────────────────────────────────
  miniPlayer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 84,
    zIndex: 900,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surf3,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.lineStrong,
    paddingHorizontal: 11,
    paddingVertical: 9,
    ...SHADOW,
  },
  miniTitle: {
    color: C.text,
    fontSize: 12.5,
    fontWeight: '700',
  },
  miniSub: {
    color: C.textMute,
    fontSize: 10,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  miniProgressTrack: {
    height: 2.5,
    borderRadius: 2,
    backgroundColor: C.surf3,
    marginTop: 6,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: C.accent,
  },
  miniBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  miniBtnText: {
    color: C.accent,
    fontSize: 14,
    fontWeight: '900',
  },
});

export default function App(): React.JSX.Element {
  return (
    <RootErrorBoundary>
      <MainApp />
    </RootErrorBoundary>
  );
}
