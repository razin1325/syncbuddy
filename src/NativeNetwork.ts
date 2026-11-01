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

const networkEmitter =
  Platform.OS === 'android' && SyncNetworkModule
    ? new NativeEventEmitter(SyncNetworkModule)
    : null;

export interface DeviceMediaItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  uri: string;
  type: 'audio' | 'video';
  format: string;
  size: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  position: number;
  duration: number;
}

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
   * Play an offline audio or video file with Google Media3
   */
  async playMediaFile(uri: string, isVideo: boolean = false): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.playMediaFile) return false;
    try {
      return await SyncNetworkModule.playMediaFile(uri, isVideo);
    } catch {
      return false;
    }
  },

  /**
   * Pause media playback
   */
  async pauseMediaFile(): Promise<boolean> {
    if (Platform.OS !== 'android' || !SyncNetworkModule?.pauseMediaFile) return false;
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
    if (Platform.OS !== 'android' || !SyncNetworkModule?.resumeMediaFile) return false;
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
    if (Platform.OS !== 'android' || !SyncNetworkModule?.stopMediaFile) return false;
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
    if (Platform.OS !== 'android' || !SyncNetworkModule?.seekMediaFile) return false;
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
      return { isPlaying: false, position: 0, duration: 0, isVideo: false };
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
    if (Platform.OS !== 'android' || !SyncNetworkModule?.getDeviceMediaFiles) return [];
    try {
      return await SyncNetworkModule.getDeviceMediaFiles(filter);
    } catch {
      return [];
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
};

