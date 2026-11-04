import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { SyncNetworkModule } = NativeModules;

export interface NetworkInfo {
  ipAddress: string;
  hasNetwork: boolean;
  isWifi: boolean;
  isHotspot: boolean;
  interfaceName: string;
  deviceName: string;
}

export interface Participant {
  id: string;
  name: string;
  ip: string;
  joinedAt: number;
  lastSeen: number;
}

export interface DiscoveredRoom {
  hostIp: string;
  port: number;
  roomCode: string;
  hostName: string;
  deviceId?: string;
  lastDiscovered: number;
}

export interface ListenerJoinedEvent {
  id: string;
  name: string;
  ip: string;
  totalCount: number;
  time: number;
}

export interface ListenerLeftEvent {
  id: string;
  name: string;
  totalCount: number;
}

export interface PttMessageEvent {
  speakerName: string;
  isTalking: boolean;
  channel?: number;
}

export interface BroadcastStateEvent {
  isPlaying: boolean;
  title: string;
  volume: number;
}

/**
 * Web-preview sample library.
 *
 * The browser has no MediaStore, so without this the Media page is always
 * empty on `expo start --web`. Real Android builds never touch this — they
 * read the device through SyncNetworkModule.
 */
const WEB_ART_COLORS: Array<[string, string]> = [
  ['#0E7490', '#164E63'],
  ['#7C3AED', '#312E81'],
  ['#B45309', '#451A03'],
  ['#047857', '#064E3B'],
  ['#BE123C', '#4C0519'],
  ['#1D4ED8', '#1E1B4B'],
];

function webArt(i: number): string {
  const [a, b] = WEB_ART_COLORS[i % WEB_ART_COLORS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>` +
    `</linearGradient></defs><rect width="200" height="200" fill="url(#g)"/>` +
    `<circle cx="100" cy="100" r="36" fill="rgba(255,255,255,0.16)"/>` +
    `<circle cx="100" cy="100" r="9" fill="rgba(255,255,255,0.35)"/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const WEB_DEMO_MEDIA: DeviceMediaItem[] = (() => {
  const day = 86400000;
  const now = Date.now();
  const mk = (
    id: string,
    title: string,
    artist: string,
    type: 'audio' | 'video',
    format: string,
    mb: number,
    durMs: number,
    daysAgo: number,
    folder?: string,
  ): DeviceMediaItem => ({
    id,
    title,
    artist,
    type,
    format,
    sizeBytes: Math.round(mb * 1024 * 1024),
    size: mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(mb * 1024)} KB`,
    duration: durMs,
    uri: `web-demo://${id}`,
    albumArt: webArt(parseInt(id.slice(1), 10) || 0),
    dateAdded: now - daysAgo * day,
    folder,
    mimeType: type === 'video' ? 'video/*' : 'audio/*',
  });

  return [
    mk('a1', 'Bagdhara - Tomaro Ki Pore Mone', 'BAGDHARA', 'audio', 'MP3', 7.26, 361000, 0),
    mk('a2', 'Khudaya Khair - Lyrical_Billu_Irfan Khan', 'Irfan Khan', 'audio', 'MP3', 5.62, 274000, 0),
    mk('a3', 'Voice note 2026-11-04 (WhatsApp)', 'You', 'audio', 'OGG', 0.42, 31000, 0),
    mk('a4', 'Boba Tunnel _ Anupam Roy _ Anupam R', 'Anupam Roy', 'audio', 'MP3', 5.0, 246000, 2),
    mk('a5', 'Cheers Together (MP3_160K)', 'Various', 'audio', 'MP3', 2.74, 132000, 2),
    mk('a6', 'Dusshopno - Odd Signature (Official)', 'Odd Signature', 'audio', 'MP3', 6.19, 305000, 5),
    mk('a7', 'Kothin - Lyrical Video - Ash King', 'Ash King', 'audio', 'M4A', 5.17, 254000, 5),
    mk('a8', 'Horror Payal Sound', 'Sound Effect', 'audio', 'MP3', 0.2, 9000, 9),
    mk('a9', 'Friday Night Mix', 'DJ Shaan', 'audio', 'FLAC', 41.5, 392000, 12),
    mk('a10', 'Podcast Ep.12 - Offline First', 'SyncBuddy FM', 'audio', 'OPUS', 18.3, 1840000, 18),
    mk('v1', "Trip to Cox's Bazar", 'Video', 'video', 'MP4', 128.4, 542000, 0, 'Camera'),
    mk('v2', 'Family Function 2026', 'Video', 'video', 'MKV', 640.2, 3620000, 2, 'Movies'),
    mk('v3', 'Old Movie (1998)', 'Video', 'video', 'AVI', 701.8, 6480000, 40, 'Downloads'),
    mk('v4', 'Screen record - bug repro', 'Video', 'video', 'MP4', 22.1, 96000, 5, 'ScreenRecords'),
  ];
})();

const networkEmitter =
  Platform.OS === 'android' && SyncNetworkModule
    ? new NativeEventEmitter(SyncNetworkModule)
    : null;

export interface DeviceMediaItem {
  id: string;
  title: string;
  artist: string;
  /** Duration in milliseconds (0 when unknown). */
  duration: number;
  uri: string;
  type: 'audio' | 'video';
  format: string;
  /** Human readable size, e.g. "5.00 MB". */
  size: string;
  sizeBytes?: number;
  album?: string;
  /** content:// URI of the cover art, empty when the file has none. */
  albumArt?: string;
  /** Epoch milliseconds (from MediaStore DATE_ADDED). */
  dateAdded?: number;
  /** Parent folder / album bucket name. */
  folder?: string;
  mimeType?: string;
}

export interface MediaPlaybackError {
  errorCode: number;
  message: string;
  uri?: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
}

/** Noise-cancellation configuration for the walkie-talkie voice path. */
export interface NoiseSuppressionConfig {
  enabled: boolean;
  /** 0..1 — how aggressively the spectral stage removes noise. */
  strength: number;
}

/** Live measurements from the native voice enhancer. */
export interface NoiseSuppressionStats extends NoiseSuppressionConfig {
  /** Mean attenuation applied by the spectral stage, in dB (positive = cut). */
  reductionDb: number;
  /** Pre-processing RMS level, 0..1. */
  inputLevel: number;
  /** Post-processing RMS level, 0..1. */
  outputLevel: number;
  /** Current automatic-gain multiplier. */
  gain: number;
  /** 0..1 value suitable for a progress meter. */
  reductionRatio: number;
}

// Remembered on the JS side too, so the setting survives across screens and is
// re-applied the next time a transmission starts.
let noiseSuppressionEnabled = true;
let noiseSuppressionStrength = 0.75;

/**
 * Web-preview transport.
 *
 * On a real device Google Media3 keeps the playhead; in the browser there is no
 * Media3 at all, so every media call used to resolve to `false` and the UI's
 * seek bar sat frozen at 0:00 — which looks like a broken player. This little
 * clock only exists so the web preview shows a live timeline. Android builds
 * never touch it (each public method checks `Platform.OS` first).
 */
const webPlayback = {
  position: 0,
  duration: 0,
  playing: false,
  startedAt: 0,
  basePosition: 0,
  timer: null as ReturnType<typeof setInterval> | null,

  tick() {
    if (!this.playing) return;
    const elapsed = (Date.now() - this.startedAt) / 1000;
    const next = this.basePosition + elapsed;
    if (this.duration > 0 && next >= this.duration) {
      // Freeze on the last frame; the app's poller sees the end and advances.
      this.position = this.duration;
      this.playing = false;
      this.basePosition = this.duration;
      return;
    }
    this.position = next;
  },

  play(durationSeconds: number, fromSeconds = 0) {
    this.duration = durationSeconds;
    this.basePosition = fromSeconds;
    this.position = fromSeconds;
    this.startedAt = Date.now();
    this.playing = true;
  },

  pause() {
    this.tick();
    this.playing = false;
    this.basePosition = this.position;
  },

  resume() {
    if (this.playing) return;
    this.startedAt = Date.now();
    this.basePosition = this.position;
    this.playing = true;
  },

  seek(seconds: number) {
    const clamped = Math.max(0, this.duration > 0 ? Math.min(seconds, this.duration) : seconds);
    this.position = clamped;
    this.basePosition = clamped;
    this.startedAt = Date.now();
  },

  stop() {
    this.playing = false;
    this.position = 0;
    this.basePosition = 0;
    this.duration = 0;
    this.startedAt = 0;
  },

  state(): PlaybackState {
    this.tick();
    return {
      isPlaying: this.playing,
      position: Math.round(this.position * 100) / 100,
      duration: this.duration,
    };
  },
};

export const NativeNetwork = {
  /**
   * Get current device local IP (Wi-Fi or Hotspot) & network connection state
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) {
      return {
        ipAddress: '192.168.1.100',
        hasNetwork: true,
        isWifi: true,
        isHotspot: false,
        interfaceName: 'wlan0',
        deviceName: 'Android Device',
      };
    }
    return await SyncNetworkModule.getNetworkInfo();
  },

  /**
   * Open Android Portable Hotspot / Tethering settings
   */
  async openHotspotSettings(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return false;
    return await SyncNetworkModule.openHotspotSettings();
  },

  /**
   * Open Android Wi-Fi settings
   */
  async openWifiSettings(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return false;
    return await SyncNetworkModule.openWifiSettings();
  },

  /**
   * Start local Host HTTP server on port 8942
   */
  async startRoomServer(roomCode: string, port: number = 8942): Promise<{ success: boolean; port: number; roomCode: string; hostName: string }> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) {
      return { success: true, port: 8942, roomCode, hostName: 'Host Phone' };
    }
    return await SyncNetworkModule.startRoomServer(roomCode, port);
  },

  /**
   * Stop local Host HTTP server
   */
  async stopRoomServer(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return true;
    return await SyncNetworkModule.stopRoomServer();
  },

  /**
   * Get list of currently connected participants from Host server
   */
  async getParticipants(): Promise<Participant[]> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return [];
    return await SyncNetworkModule.getParticipants();
  },

  /**
   * Host updates broadcast state (music playing, track title, volume)
   */
  async updateBroadcastState(isPlaying: boolean, title: string, volume: number): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return true;
    return await SyncNetworkModule.updateBroadcastState(isPlaying, title, volume);
  },

  /**
   * Start UDP discovery beacon listener on port 8943
   */
  async startDiscovery(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return true;
    return await SyncNetworkModule.startDiscovery();
  },

  /**
   * Stop UDP discovery beacon listener
   */
  async stopDiscovery(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule) return true;
    return await SyncNetworkModule.stopDiscovery();
  },

  /**
   * Open Real Camera QR Scanner on Android
   */
  async openCameraScanner(): Promise<string> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.openCameraScanner) {
      throw new Error('Camera scanner not supported');
    }
    return await SyncNetworkModule.openCameraScanner();
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Real-Time Offline Audio Streaming Pipeline
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start receiving real low-latency audio stream over local LAN and playing through headphones/speaker
   */
  async startAudioReceiver(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.startAudioReceiver) return true;
    return await SyncNetworkModule.startAudioReceiver();
  },

  /**
   * Stop audio receiver and release AudioTrack
   */
  async stopAudioReceiver(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopAudioReceiver) return true;
    return await SyncNetworkModule.stopAudioReceiver();
  },

  /**
   * Register a direct peer IP so UDP audio and PTT packets are sent directly (bypassing router AP isolation)
   */
  async registerPeerIp(ip: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.registerPeerIp) return true;
    return await SyncNetworkModule.registerPeerIp(ip);
  },

  /**
   * Start broadcasting audio stream (source: 'mic' or 'music') to all devices on LAN.
   * For 'music'/'lecture'/'ambient' sources, this uses Android's AudioPlaybackCapture API
   * to capture whatever is currently playing on the phone (Spotify, YouTube, etc.)
   * and stream it to all connected listeners.
   * The user will see a one-time Android permission dialog asking to allow audio capture.
   */
  async startAudioBroadcaster(sourceType: string = 'mic'): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.startAudioBroadcaster) return true;
    return await SyncNetworkModule.startAudioBroadcaster(sourceType);
  },

  /**
   * Stop broadcasting audio stream (also stops system audio capture service if running)
   */
  async stopAudioBroadcaster(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopAudioBroadcaster) return true;
    return await SyncNetworkModule.stopAudioBroadcaster();
  },

  /**
   * Request system audio capture permission (MediaProjection).
   * Shows Android consent dialog, then starts foreground service to capture system audio.
   */
  async requestSystemAudioCapture(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.requestSystemAudioCapture) return false;
    return await SyncNetworkModule.requestSystemAudioCapture();
  },

  /**
   * Stop system audio capture foreground service
   */
  async stopSystemAudioCapture(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopSystemAudioCapture) return true;
    return await SyncNetworkModule.stopSystemAudioCapture();
  },

  /**
   * Enable/disable walkie-talkie voice noise cancellation.
   * @param enabled  true = clean the mic signal.
   * @param strength 0..1, how aggressively to remove noise.
   */
  async setNoiseSuppression(enabled: boolean, strength = 0.75): Promise<boolean> {
    noiseSuppressionEnabled = enabled;
    noiseSuppressionStrength = strength;
    if (Platform.OS !== 'android' || !SyncNetworkModule?.setNoiseSuppression) return true;
    try {
      return await SyncNetworkModule.setNoiseSuppression(enabled, strength);
    } catch {
      return false;
    }
  },

  /** Read back the current noise-suppression configuration. */
  async getNoiseSuppression(): Promise<NoiseSuppressionConfig> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getNoiseSuppression) {
      return { enabled: noiseSuppressionEnabled, strength: noiseSuppressionStrength };
    }
    try {
      return await SyncNetworkModule.getNoiseSuppression();
    } catch {
      return { enabled: noiseSuppressionEnabled, strength: noiseSuppressionStrength };
    }
  },

  /**
   * Live noise-reduction measurements from the native voice enhancer.
   * On web there is no DSP, so it reports a plausible idle shape.
   */
  async getNoiseSuppressionStats(): Promise<NoiseSuppressionStats> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getNoiseSuppressionStats) {
      return {
        enabled: noiseSuppressionEnabled,
        strength: noiseSuppressionStrength,
        reductionDb: 0,
        inputLevel: 0,
        outputLevel: 0,
        gain: 1,
        reductionRatio: 0,
      };
    }
    try {
      return await SyncNetworkModule.getNoiseSuppressionStats();
    } catch {
      return {
        enabled: noiseSuppressionEnabled,
        strength: noiseSuppressionStrength,
        reductionDb: 0,
        inputLevel: 0,
        outputLevel: 0,
        gain: 1,
        reductionRatio: 0,
      };
    }
  },

  /**
   * Open native file picker to choose an offline music/audio file from storage
   */
  async pickAudioFile(): Promise<{ uri: string; name: string } | null> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.pickAudioFile) return null;
    try {
      return await SyncNetworkModule.pickAudioFile();
    } catch {
      return null;
    }
  },

  /**
   * Play an offline audio or video file with Google Media3 and real-time UDP room sync
   */
  async playMediaFile(
    uri: string,
    isVideo: boolean = false,
    broadcastToRoom: boolean = true,
    mimeType: string = '',
    durationSeconds: number = 0,
  ): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.playMediaFile) {
      // Browser preview: run the local clock so the transport is explorable.
      webPlayback.play(durationSeconds, 0);
      return true;
    }
    try {
      return await SyncNetworkModule.playMediaFile(uri, isVideo, broadcastToRoom, mimeType);
    } catch {
      return false;
    }
  },

  /**
   * Pause media playback
   */
  async pauseMediaFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.pauseMediaFile) {
      webPlayback.pause();
      return true;
    }
    try {
      return await SyncNetworkModule.pauseMediaFile();
    } catch {
      return false;
    }
  },

  /**
   * Resume media playback
   */
  async resumeMediaFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.resumeMediaFile) {
      webPlayback.resume();
      return true;
    }
    try {
      return await SyncNetworkModule.resumeMediaFile();
    } catch {
      return false;
    }
  },

  /**
   * Stop media playback
   */
  async stopMediaFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopMediaFile) {
      webPlayback.stop();
      return true;
    }
    try {
      return await SyncNetworkModule.stopMediaFile();
    } catch {
      return false;
    }
  },

  /**
   * Seek media playback to a specific timestamp in seconds
   */
  async seekMediaFile(positionSeconds: number): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.seekMediaFile) {
      webPlayback.seek(positionSeconds);
      return true;
    }
    try {
      return await SyncNetworkModule.seekMediaFile(positionSeconds);
    } catch {
      return false;
    }
  },

  /**
   * Get live media playback progress and duration in seconds
   */
  async getMediaPlaybackState(): Promise<{ isPlaying: boolean; position: number; duration: number; isVideo: boolean }> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getMediaPlaybackState) {
      const s = webPlayback.state();
      return { isPlaying: s.isPlaying, position: s.position, duration: s.duration, isVideo: false };
    }
    try {
      return await SyncNetworkModule.getMediaPlaybackState();
    } catch {
      return { isPlaying: false, position: 0, duration: 0, isVideo: false };
    }
  },

  /**
   * Launch native edge-to-edge fullscreen video player activity (VLC Style)
   */
  async launchFullscreenVideo(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.launchFullscreenVideo) return false;
    try {
      return await SyncNetworkModule.launchFullscreenVideo();
    } catch {
      return false;
    }
  },

  /**
   * Play an offline audio file and stream its decoded PCM frames to all listeners
   */
  async playAudioFile(uri: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.playAudioFile) return false;
    try {
      return await SyncNetworkModule.playAudioFile(uri);
    } catch {
      return false;
    }
  },

  /**
   * Stop playing the offline audio file
   */
  async stopAudioFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopAudioFile) return false;
    try {
      return await SyncNetworkModule.stopAudioFile();
    } catch {
      return false;
    }
  },

  /**
   * Pause the offline audio file playback
   */
  async pauseAudioFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.pauseAudioFile) return false;
    try {
      return await SyncNetworkModule.pauseAudioFile();
    } catch {
      return false;
    }
  },

  /**
   * Resume the offline audio file playback
   */
  async resumeAudioFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.resumeAudioFile) return false;
    try {
      return await SyncNetworkModule.resumeAudioFile();
    } catch {
      return false;
    }
  },

  /**
   * Scan device storage for all music/audio tracks (like VLC / Samsung Music)
   */
  async getDeviceAudioFiles(): Promise<Array<{ id: string; title: string; artist: string; duration: number; uri: string }>> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getDeviceAudioFiles) return [];
    try {
      return await SyncNetworkModule.getDeviceAudioFiles();
    } catch {
      return [];
    }
  },

  /**
   * Scan device storage for all audio and video media files (Google Media3 / VLC / My Files style)
   */
  async getDeviceMediaFiles(filter: 'all' | 'audio' | 'video' = 'all'): Promise<DeviceMediaItem[]> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getDeviceMediaFiles) {
      return filter === 'all'
        ? WEB_DEMO_MEDIA
        : WEB_DEMO_MEDIA.filter(m => m.type === filter);
    }
    try {
      return await SyncNetworkModule.getDeviceMediaFiles(filter);
    } catch {
      return [];
    }
  },

  /**
   * Hand a file to another installed player (VLC, MX Player, Files...) for
   * containers/codecs that the built-in Media3 engine cannot demux (AVI, TS, WMV...).
   */
  async openWithExternalPlayer(uri: string, mimeType: string = ''): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.openWithExternalPlayer) return false;
    try {
      const safeMime = mimeType && /^(audio|video)\//i.test(mimeType) ? mimeType : '*/*';
      return await SyncNetworkModule.openWithExternalPlayer(uri, safeMime);
    } catch {
      return false;
    }
  },

  /**
   * Seek audio playback to a specific timestamp in seconds
   */
  async seekAudioFile(positionSeconds: number): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.seekAudioFile) return false;
    try {
      return await SyncNetworkModule.seekAudioFile(positionSeconds);
    } catch {
      return false;
    }
  },

  /**
   * Get live playback progress and duration in seconds
   */
  async getAudioPlaybackState(): Promise<PlaybackState> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getAudioPlaybackState) {
      return { isPlaying: false, position: 0, duration: 0 };
    }
    try {
      return await SyncNetworkModule.getAudioPlaybackState();
    } catch {
      return { isPlaying: false, position: 0, duration: 0 };
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Client (Listener) HTTP Network Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Join a host's room over local LAN
   */
  async joinRoom(
    hostIp: string,
    port: number,
    listenerName: string,
    listenerId: string,
    roomCode?: string
  ): Promise<{
    success: boolean;
    roomCode?: string;
    hostName?: string;
    participantsCount?: number;
    isBroadcasting?: boolean;
    trackTitle?: string;
    reason?: string;
    message?: string;
  }> {
    const url = `http://${hostIp}:${port}/join`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: listenerName, id: listenerId, code: roomCode || '' }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        throw new Error(`HTTP_${resp.status}`);
      }
      const data = await resp.json();
      if (data && data.success) {
        SyncNetworkModule?.registerPeerIp(hostIp);
      }
      return data;
    } catch (e: any) {
      clearTimeout(timeout);
      throw e;
    }
  },

  /**
   * Send heartbeat to keep connection alive and fetch latest room state
   */
  async sendHeartbeat(
    hostIp: string,
    port: number,
    listenerId: string
  ): Promise<{ participantsCount: number; isBroadcasting: boolean; trackTitle: string; volume: number }> {
    const url = `http://${hostIp}:${port}/heartbeat`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listenerId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return await resp.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  },

  /**
   * Send Walkie-Talkie Push-to-Talk message to Host (which relays to all)
   */
  async sendPttMessage(
    hostIp: string,
    port: number,
    speakerName: string,
    isTalking: boolean,
    channel: number = 1
  ): Promise<boolean> {
    const url = `http://${hostIp}:${port}/ptt`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speakerName, isTalking, channel }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Broadcast PTT status to all devices on the network via UDP
   */
  async broadcastPtt(speakerName: string, isTalking: boolean): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.broadcastPtt) return true;
    return await SyncNetworkModule.broadcastPtt(speakerName, isTalking);
  },

  /**
   * Leave room on Host
   */
  async leaveRoom(hostIp: string, port: number, listenerId: string): Promise<boolean> {
    const url = `http://${hostIp}:${port}/leave`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: listenerId }),
      });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Show persistent ongoing status notification at the top of the mobile device
   */
  async showPersistentNotification(title: string, message: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.showPersistentNotification) return false;
    try {
      return await SyncNetworkModule.showPersistentNotification(title, message);
    } catch {
      return false;
    }
  },

  /**
   * Dismiss the persistent status notification
   */
  async dismissPersistentNotification(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.dismissPersistentNotification) return false;
    try {
      return await SyncNetworkModule.dismissPersistentNotification();
    } catch {
      return false;
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Native Event Listeners
  // ───────────────────────────────────────────────────────────────────────────

  onListenerJoined(callback: (event: ListenerJoinedEvent) => void) {
    return networkEmitter?.addListener('ON_LISTENER_JOINED', callback);
  },

  onListenerLeft(callback: (event: ListenerLeftEvent) => void) {
    return networkEmitter?.addListener('ON_LISTENER_LEFT', callback);
  },

  onPttMessage(callback: (event: PttMessageEvent) => void) {
    return networkEmitter?.addListener('ON_PTT_MESSAGE', callback);
  },

  onRoomDiscovered(callback: (event: DiscoveredRoom) => void) {
    return networkEmitter?.addListener('ON_ROOM_DISCOVERED', callback);
  },

  onBroadcastState(callback: (event: BroadcastStateEvent) => void) {
    return networkEmitter?.addListener('ON_BROADCAST_STATE', callback);
  },

  /**
   * Fired when the native Media3 player fails (unsupported container/codec,
   * corrupt file, revoked URI permission...). The UI uses this to offer the
   * "open in another player" fallback instead of silently playing nothing.
   */
  onMediaError(callback: (event: MediaPlaybackError) => void) {
    return networkEmitter?.addListener('ON_MEDIA_ERROR', callback);
  },
};

