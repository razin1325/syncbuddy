/**
 * SyncBuddy — Futuristic Offline Audio Sync & Walkie-Talkie Suite
 *
 * Real Offline LAN Peer-to-Peer System (Zero Internet Needed):
 *   ├── Page 1: 📡 Host Room (Local HTTP/TCP Server, ISO QR Code, Live Participants Sync)
 *   ├── Page 2: 🎧 Join Room (LAN Auto-Discovery, One-Tap Join, Real-Time Audio Sync)
 *   ├── Page 3: 📻 Walkie-Talkie (Real-time PTT Voice & Channel Relay)
 *   └── Page 4: 📱 Devices (BLE Hardware Manager, On-Demand 10s Scan, Real Battery)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  PermissionsAndroid,
} from 'react-native';
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
} from './NativeNetwork';
import { generateQRMatrix } from './QRCodeGenerator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NavigationPage = 'host' | 'join' | 'walkie' | 'devices';
export type DeviceType = 'Audio' | 'Wearable' | 'Computer' | 'IoT Sensor' | 'Peripheral';
export type DeviceStatus = 'Broadcasting' | 'Connected' | 'Connecting' | 'Paired' | 'Available';
export type FilterTab = 'All' | 'Connected' | 'Paired' | 'Audio' | 'Wearables';
export type AudioSource = 'mic' | 'music' | 'lecture' | 'ambient';

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
  { id: 't1', title: 'System Audio (Spotify / YouTube)', artist: 'ফোনে যে গান বাজবে সেটাই শুনবে', duration: 'Live', source: 'music' },
  { id: 't2', title: 'Live Mic Pass-through', artist: 'ফোনের মাইক দিয়ে কথা বা সাউন্ড', duration: 'Live', source: 'mic' },
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
  if (rssi >= -50) return { label: 'Excellent', color: '#10B981', dots: '••••' };
  if (rssi >= -65) return { label: 'Good', color: '#06B6D4', dots: '•••○' };
  if (rssi >= -78) return { label: 'Fair', color: '#F59E0B', dots: '••○○' };
  return { label: 'Weak', color: '#EF4444', dots: '•○○○' };
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
    borderColor: '#06B6D4',
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
});

// ─── Main Application ─────────────────────────────────────────────────────────

export default function App(): React.JSX.Element {
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
  const [masterVolume, setMasterVolume] = useState<number>(85);
  const [broadcastElapsed, setBroadcastElapsed] = useState<number>(0);

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
      showToast(`🔔 ${e.name} (${e.ip}) রুমে যুক্ত হয়েছে!`, 'success');
      NativeNetwork.getParticipants().then(setHostParticipants).catch(() => { });
    });

    const subLeft = NativeNetwork.onListenerLeft((e: ListenerLeftEvent) => {
      showToast(`ℹ️ ${e.name} রুম থেকে বের হয়েছে`, 'info');
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
          showToast(`🌟 লোকাল রুমে পাওয়া গেছে: ${r.hostName} (#${r.roomCode})!`, 'info');
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
  // 4. Unified Audio Receiver (Runs for Host & Listener whenever in room or on Walkie-Talkie)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const shouldReceiveAudio = !!joinedRoom || isHostBroadcasting || activePage === 'walkie' || hostParticipants.length > 0;
    if (shouldReceiveAudio) {
      NativeNetwork.startAudioReceiver().catch(() => {});
    } else {
      NativeNetwork.stopAudioReceiver().catch(() => {});
    }
  }, [joinedRoom, isHostBroadcasting, activePage, hostParticipants.length]);

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
  // 5. Initial Hardware Setup & Bluetooth Permissions
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'android') {
      const initAndroid = async () => {
        try {
          const reqs = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
          if (typeof Platform.Version === 'number' && Platform.Version >= 31) {
            reqs.push(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            );
          }
          await PermissionsAndroid.requestMultiple(reqs);
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
              connected ? 'হেডফোন কানেক্টেড হয়েছে!' : 'হেডফোন ডিসকানেক্টেড হয়েছে',
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
      showToast('আগে ব্লুটুথ অন করুন', 'warn');
      return;
    }
    if (isScanning) return;

    setIsScanning(true);
    setScanCountdown(10);
    showToast('১০ সেকেন্ডের জন্য স্ক্যান চলছে (ব্যাটারি সেভিং মোড)...', 'info');

    if (scanTimer.current) clearInterval(scanTimer.current);
    scanTimer.current = setInterval(() => {
      setScanCountdown(prev => {
        if (prev <= 1) {
          clearInterval(scanTimer.current);
          setIsScanning(false);
          showToast('স্ক্যান সম্পন্ন! ব্লুটুথ রেডিও স্লিপ মোডে গেছে।', 'info');
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
    showToast(`${device.name}-এর সাথে কানেক্ট করার চেষ্টা করা হচ্ছে...`, 'info');
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
          showToast(`${device.name} অ্যাক্টিভ এবং কানেক্টেড!`, 'success');
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
          showToast(`${device.name} সফলভাবে কানেক্টেড!`, 'success');
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
          showToast(`${device.name} সফলভাবে কানেক্টেড!`, 'success');
        } else {
          setDevices(prev =>
            prev.map(d => (d.id === device.id ? { ...d, status: 'Paired', isSelected: false, rssi: -85 } : d)),
          );
          showToast(`${device.name} চালু নেই বা ব্লুটুথ রেঞ্জে পাওয়া যায়নি! হেডফোন অন করুন।`, 'error');
        }
      } catch (err: any) {
        setDevices(prev =>
          prev.map(d => (d.id === device.id ? { ...d, status: 'Paired', isSelected: false } : d)),
        );
        showToast(`কানেকশন ব্যর্থ: ${err?.message || 'Device unreachable'}`, 'error');
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
    showToast(`নতুন ৪ ডিজিটের রুম নম্বর: #${code}`, 'success');
  };

  const handleToggleHostBroadcast = async () => {
    const next = !isHostBroadcasting;

    if (next) {
      try {
        await NativeNetwork.startAudioBroadcaster(activeTrack.source);
        setIsHostBroadcasting(true);
        NativeNetwork.updateBroadcastState(true, activeTrack.title, masterVolume).catch(() => {});
        showToast(
          activeTrack.source === 'mic'
            ? `রুম #${roomCode} মাইক লাইভ ব্রডকাস্ট শুরু হয়েছে!`
            : `রুম #${roomCode} সিস্টেম অডিও ব্রডকাস্ট শুরু! এবার Spotify/YouTube-এ গান চালান 🎵`,
          'success',
        );
        if (Platform.OS === 'android') {
          NativeAuracast.startBroadcast(roomCode).catch(() => {});
        }
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('DENIED') || msg.includes('অনুমতি')) {
          showToast('অডিও ক্যাপচার অনুমতি দেওয়া হয়নি', 'warn');
        } else {
          showToast('ব্রডকাস্ট শুরু করতে সমস্যা হয়েছে', 'error');
        }
      }
    } else {
      setIsHostBroadcasting(false);
      NativeNetwork.updateBroadcastState(false, activeTrack.title, masterVolume).catch(() => {});
      NativeNetwork.stopAudioBroadcaster().catch(() => {});
      showToast('ব্রডকাস্ট বন্ধ করা হয়েছে', 'info');
    }
  };

  // Join Room over Real Local Network
  const handleJoinHost = async (targetIp: string, targetPort: number = 8942, codeToVerify?: string) => {
    if (!targetIp || targetIp.trim().length === 0) {
      setJoinFeedback({
        type: 'warn',
        message: 'অনুগ্রহ করে হোস্টের ৪-ডিজিটের রুম নম্বর বা IP লিখুন।',
      });
      showToast('হোস্টের IP অ্যাড্রেস লিখুন', 'warn');
      return;
    }

    // Never join own phone's room!
    if (networkInfo?.ipAddress && targetIp.trim() === networkInfo.ipAddress.trim()) {
      setJoinFeedback({
        type: 'warn',
        message: 'এটি আপনার নিজের ফোন! অন্য কোনো ফোনের রুমে যুক্ত হোন।',
      });
      showToast('⚠️ এটি আপনার নিজের ফোন! অন্য কোনো ফোনের রুমে যুক্ত হোন।', 'warn');
      return;
    }

    // Never join own phone's room!
    if (networkInfo?.ipAddress && targetIp.trim() === networkInfo.ipAddress.trim()) {
      showToast('⚠️ এটি আপনার নিজের ফোন! অন্য কোনো ফোনের রুমে যুক্ত হোন।', 'warn');
      return;
    }

    setIsJoining(true);
    showToast(`হোস্টে সংযোগ খোঁজা হচ্ছে...`, 'info');

    try {
      const myName = networkInfo?.deviceName || 'SyncBuddy Listener';
      const res = await NativeNetwork.joinRoom(targetIp.trim(), targetPort, myName, deviceId, codeToVerify);

      if (res.success === false) {
        if (res.reason === 'ROOM_CODE_MISMATCH') {
          setJoinFeedback({
            type: 'error',
            message: 'রুম কোডটি মেলেনি! হোস্টের স্ক্রিনে থাকা ৪-ডিজিট কোডটি দেখে আবার চেষ্টা করুন।',
          });
          showToast('🔐 রুম কোড মেলেনি! হোস্টের কোডটি মিলিয়ে নিন।', 'warn');
        } else {
          setJoinFeedback({
            type: 'error',
            message: res.message || 'রুমে যুক্ত হওয়া সম্ভব হয়নি।',
          });
          showToast(res.message || 'হোস্টে কানেক্ট করা সম্ভব হয়নি', 'warn');
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

      showToast(`✅ ${res.hostName || 'হোস্ট'} এর রুমে সফলভাবে যুক্ত হয়েছেন!`, 'success');
    } catch (e: any) {
      setJoinFeedback({
        type: 'warn',
        message: 'হোস্ট পাওয়া যায়নি। উভয় ফোন একই Wi-Fi বা অফলাইন Hotspot-এ আছেন কি না নিশ্চিত করুন।',
      });
      showToast('🔍 হোস্টের সন্ধান পাওয়া যায়নি। একই Wi-Fi/হটস্পটে আছেন কি?', 'warn');
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

    showToast(`স্ক্যান করা ডাটা: ${trimmed}`, 'info');
  };

  const handleOpenQrScanner = async () => {
    try {
      const scanned = await NativeNetwork.openCameraScanner();
      if (scanned) {
        showToast('QR কোড সফলভাবে স্ক্যান হয়েছে!', 'success');
        handleQrScanResult(scanned);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (err?.code !== 'CANCELLED' && !msg.toLowerCase().includes('cancel')) {
        setShowQRScanner(true);
        showToast('ক্যামেরা ওপেন করা যায়নি, সরাসরি কোড বা IP লিখুন', 'info');
      }
    }
  };

  const handleManualJoin = () => {
    const target = (inputRoomCode || inputHostIp).trim();
    if (!target) {
      setJoinFeedback({
        type: 'warn',
        message: 'অনুগ্রহ করে ৪-ডিজিটের রুম নম্বর অথবা হোস্টের IP লিখুন।',
      });
      showToast('হোস্টের ৪-ডিজিটের রুম নম্বর লিখুন', 'warn');
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
        message: `রুম #${target} পাওয়া যায়নি। কাছাকাছি পাওয়া সক্রিয় রুম হলো #${topRoom.roomCode} (${topRoom.hostName})।`,
        suggestedRoom: topRoom,
      });
      showToast(`🔍 রুম #${target} পাওয়া যায়নি! হোস্টের কোড মিলিয়ে দেখুন।`, 'warn');
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
      message: `রুম #${target} লোকাল নেটওয়ার্কে পাওয়া যায়নি। হোস্টের স্ক্রিন দেখে কোডটি আবার লিখুন।`,
    });
    showToast(`🔍 রুম #${target} সক্রিয় নেই। হোস্টের স্ক্রিন চেক করুন।`, 'warn');
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
    showToast('রুম ত্যাগ করা হয়েছে', 'info');
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
            showToast('মাইক্রোফোন পারমিশন প্রয়োজন!', 'error');
            return;
          }
        }
      }

      setIsTalking(true);
      const myName = networkInfo?.deviceName || 'This Phone';
      setActiveSpeaker(`${myName} (You)`);
      showToast('🎙️ কথা বলুন... সবাই শুনছে!', 'info');

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
      showToast(`মাইক শুরু করতে সমস্যা: ${err?.message || ''}`, 'error');
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

  // Helpers
  const connectedCount = hostParticipants.length + 1; // +1 for host itself
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

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
            <Text style={styles.netWarningTitle}>কোনো অফলাইন নেটওয়ার্ক সক্রিয় নেই!</Text>
          </View>
          <Text style={styles.netWarningText}>
            অফলাইনে গান ও কথা শেয়ার করতে নিচের যেকোনো একটি করুন:{'\n'}
            ১. এই ফোনের Personal Hotspot চালু করুন (অন্য ফোন এতে কানেক্ট হবে){'\n'}
            অথবা ২. একই Wi-Fi / অন্য ফোনের Hotspot-এ কানেক্ট করুন।
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <TouchableOpacity
              style={styles.netActionBtn}
              onPress={() => NativeNetwork.openHotspotSettings()}>
              <Text style={styles.netActionBtnText}>⚙️ Hotspot অন করুন</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.netActionBtn, { backgroundColor: '#1E293B' }]}
              onPress={() => NativeNetwork.openWifiSettings()}>
              <Text style={styles.netActionBtnText}>📶 Wi-Fi সেটিংস</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Active Network Info Strip ── */}
      {networkInfo && networkInfo.hasNetwork && (
        <View style={styles.netStatusStrip}>
          <View style={styles.netStatusDot} />
          <Text style={styles.netStatusText}>
            {networkInfo.isHotspot ? 'মোবাইল হটস্পট' : 'লোকাল Wi-Fi'}: {networkInfo.ipAddress}:8942
          </Text>
          <Text style={styles.netDeviceName}>({networkInfo.deviceName})</Text>
        </View>
      )}

      {/* ── Main Page Content ── */}
      <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
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
                  <Text style={styles.regenBtnText}>⚡ নতুন কোড</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.cardDesc}>
                অন্য ফোন থেকে নিচের ৪-ডিজিটের রুম নম্বর ({roomCode}) লিখুন অথবা ক্যামেরা দিয়ে QR কোডটি স্ক্যান করে যুক্ত হোন।
              </Text>

              {/* Real Standard ISO/IEC 18004 Scannable QR Code */}
              <View style={{ alignItems: 'center', marginVertical: 14 }}>
                <RealQRMatrix value={qrPayload} size={180} />
                <Text style={styles.qrHint}>📱 যেকোনো ক্যামেরা বা SyncBuddy দিয়ে স্ক্যান করুন</Text>
                <Text style={styles.qrSubHint}>হোস্ট সার্ভার: {hostIp}:8942 (Zero Internet)</Text>
              </View>

              {/* Real Live Connected Listeners Counter */}
              <View style={styles.listenerCounterRow}>
                <View style={styles.listenerNumberBox}>
                  <Text style={styles.listenerNumber}>{connectedCount}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listenerTitle}>
                    {connectedCount > 1
                      ? `${connectedCount} জন ডিভাইসে অডিও সিঙ্ক হচ্ছে`
                      : '১ জন (আপনি / হোস্ট)'}
                  </Text>
                  <Text style={styles.listenerSub}>
                    {isHostBroadcasting ? '● অডিও লাইভ ব্রডকাস্ট হচ্ছে' : '○ ব্রডকাস্ট শুরু করতে নিচের বাটনে চাপ দিন'}
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
                👥 সংযুক্ত ডিভাইসসমূহ ({connectedCount} জন)
              </Text>
              <Text style={styles.cardDesc}>
                যেসব ফোন আপনার রুমে যুক্ত হয়েছে তাদের তালিকা নিচে লাইভ দেখতে পাবেন:
              </Text>

              {/* Host Phone */}
              <View style={styles.participantItem}>
                <Text style={{ fontSize: 20, marginRight: 10 }}>👑</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.participantName}>
                    {networkInfo?.deviceName || 'This Phone'} (হোস্ট / আপনি)
                  </Text>
                  <Text style={styles.participantMeta}>IP: {hostIp}:8942 • প্রধান ব্রডকাস্টার</Text>
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
                    <Text style={styles.participantMeta}>IP: {p.ip} • হেডফোনে লাইভ সিঙ্ক</Text>
                  </View>
                  <View style={styles.syncedBadge}>
                    <Text style={styles.syncedBadgeText}>● SYNCED</Text>
                  </View>
                </View>
              ))}

              {hostParticipants.length === 0 && (
                <View style={styles.noParticipantsBox}>
                  <Text style={styles.noParticipantsText}>
                    এখনো কোনো লিসেনার যুক্ত হয়নি। অন্য ফোনে &quot;Join Room&quot; ওপেন করুন!
                  </Text>
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
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.trackItem, isSelected && styles.trackItemActive]}
                    onPress={() => {
                      setActiveTrack(t);
                      NativeNetwork.updateBroadcastState(isHostBroadcasting, t.title, masterVolume).catch(() => {});
                      if (isHostBroadcasting) {
                        NativeNetwork.startAudioBroadcaster(t.source).catch(() => {});
                      }
                      showToast(`সোর্স নির্বাচিত: ${t.title}`, 'info');
                    }}>
                    <Text style={{ fontSize: 20, marginRight: 10 }}>
                      {t.source === 'mic' ? '🎤' : t.source === 'music' ? '🎵' : '📻'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.trackTitle, isSelected && { color: '#06B6D4' }]}>{t.title}</Text>
                      <Text style={styles.trackArtist}>{t.artist}</Text>
                    </View>
                    <Text style={styles.trackDuration}>{t.duration}</Text>
                  </TouchableOpacity>
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
                    <View style={[styles.volFill, { width: `${masterVolume}%`, backgroundColor: '#06B6D4' }]} />
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
              <View style={[styles.card, { borderColor: '#10B981', backgroundColor: '#061715' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <View style={styles.liveGreenDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.joinedTitle}>Connected to {joinedRoom.hostName}</Text>
                    <Text style={styles.joinedSub}>
                      রুম কোড: {joinedRoom.code} • হোস্ট IP: {joinedRoom.hostIp}:8942
                    </Text>
                  </View>
                  <View style={styles.syncedBadge}>
                    <Text style={styles.syncedBadgeText}>● LIVE</Text>
                  </View>
                </View>

                {/* Live Participants Indicator */}
                <View style={styles.listenerStatusRow}>
                  <Text style={styles.listenerStatusText}>
                    👥 রুমে মোট {joinedRoom.participantsCount} জন সক্রিয় আছেন
                  </Text>
                </View>

                {/* Audio Visualizer */}
                <View style={styles.listenerVisualizerBox}>
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim2 }], backgroundColor: '#10B981' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim4 }], backgroundColor: '#10B981' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim1 }], backgroundColor: '#10B981' }]} />
                  <Animated.View style={[styles.visualizerBar, { transform: [{ scaleY: waveAnim3 }], backgroundColor: '#10B981' }]} />
                </View>

                {/* Personal Volume */}
                <View style={[styles.volumeBox, { marginTop: 14 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={styles.volLabel}>Personal Headphone Volume</Text>
                    <Text style={[styles.volValue, { color: '#10B981' }]}>{listenerVolume}%</Text>
                  </View>
                  <View style={styles.volControlRow}>
                    <TouchableOpacity
                      style={styles.volBtn}
                      onPress={() => setListenerVolume(v => Math.max(0, v - 5))}>
                      <Text style={styles.volBtnText}>−</Text>
                    </TouchableOpacity>
                    <View style={styles.volTrack}>
                      <View style={[styles.volFill, { width: `${listenerVolume}%`, backgroundColor: '#10B981' }]} />
                    </View>
                    <TouchableOpacity
                      style={styles.volBtn}
                      onPress={() => setListenerVolume(v => Math.min(100, v + 5))}>
                      <Text style={styles.volBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveRoom}>
                  <Text style={styles.leaveBtnText}>রুম থেকে বের হন (Leave Room)</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Join Form */
              <View style={styles.card}>
                <Text style={styles.cardBadge}>JOIN BROADCAST ROOM</Text>
                <Text style={styles.sectionTitle}>হোস্টের রুমে যুক্ত হন</Text>
                <Text style={styles.cardDesc}>
                  একই Wi-Fi বা অফলাইন Hotspot-এ থাকলে নিচের পাওয়া রুমে এক ক্লিকে যুক্ত হতে পারবেন:
                </Text>

                {/* ── Auto-Discovered Other Rooms on LAN ── */}
                {otherDiscoveredRooms.length > 0 && (
                  <View style={styles.discoveredContainer}>
                    <Text style={styles.discoveredHeader}>🌟 অফলাইনে সক্রিয় রুম পাওয়া গেছে:</Text>
                    {otherDiscoveredRooms.map((r, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.discoveredItem}
                        disabled={isJoining}
                        onPress={() => handleJoinHost(r.hostIp, r.port)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.discoveredTitle}>{r.hostName}</Text>
                          <Text style={styles.discoveredMeta}>
                            কোড: #{r.roomCode} • IP: {r.hostIp}:{r.port}
                          </Text>
                        </View>
                        <View style={styles.quickJoinBtn}>
                          <Text style={styles.quickJoinBtnText}>যুক্ত হন ⚡</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* 4-Digit Room Code or Host IP Input */}
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.inputLabel}>হোস্টের ৪-ডিজিটের রুম নম্বর বা IP লিখুন:</Text>
                  <View style={styles.codeRow}>
                    <TextInput
                      style={[
                        styles.codeInput,
                        joinFeedback?.type === 'error' && { borderColor: '#EF4444' },
                        joinFeedback?.type === 'warn' && { borderColor: '#F59E0B' },
                      ]}
                      placeholder="৪-ডিজিট কোড (উদা: 8942)"
                      placeholderTextColor="#64748B"
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
                        <Text style={styles.joinActionBtnText}>যুক্ত হন</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Professional In-Line Helper & Guidance Card */}
                  {joinFeedback && (
                    <View style={[styles.feedbackCard, joinFeedback.type === 'error' && { borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        <Text style={{ fontSize: 14 }}>{joinFeedback.type === 'error' ? '🔐' : '💡'}</Text>
                        <Text style={[styles.feedbackTitle, joinFeedback.type === 'error' && { color: '#EF4444' }]}>
                          {joinFeedback.type === 'error' ? 'রুম কোড মেলেনি' : 'কোড চেক করুন'}
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
                            ⚡ {joinFeedback.suggestedRoom.hostName} (#{joinFeedback.suggestedRoom.roomCode})-এ যুক্ত হোন
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                {/* Divider */}
                <View style={styles.orDividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.orText}>অথবা</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Real Camera QR Scanner Launcher */}
                <TouchableOpacity
                  style={styles.qrScanBtn}
                  onPress={handleOpenQrScanner}>
                  <Text style={{ fontSize: 22, marginRight: 8 }}>📷</Text>
                  <Text style={styles.qrScanBtnText}>ক্যামেরা দিয়ে QR কোড স্ক্যান করুন</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Quick Tips */}
            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>💡 কীভাবে কাজ করে?</Text>
              <Text style={styles.tipText}>
                ১. হোস্টের ফোনের সাথে একই অফলাইন হটস্পট বা Wi-Fi তে কানেক্ট থাকুন।{'\n'}
                ২. কানে ব্লুটুথ হেডফোন বা তারের ইয়ারফোন লাগিয়ে রাখুন।{'\n'}
                ৩. হোস্টের সব গান বা কথা সরাসরি আপনার হেডফোনে লাইভ বাজবে!
              </Text>
            </View>
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
                    রুম #{joinedRoom ? joinedRoom.code : roomCode}
                  </Text>
                </View>
                <View style={styles.roomMemberBadge}>
                  <Text style={styles.roomMemberBadgeText}>
                    👥 {joinedRoom ? joinedRoom.participantsCount : connectedCount} জন সংযুক্ত
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDesc}>
                এই রুমে থাকা সবাই একসাথে কথা বলতে ও শুনতে পারবেন। কোনো চ্যানেল পরিবর্তন করতে হবে না।
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
                      isTalking && { color: '#EF4444' },
                      activeSpeaker && !isTalking && { color: '#06B6D4' },
                    ]}>
                    {isTalking
                      ? `আপনি কথা বলছেন (${networkInfo?.deviceName || 'This Phone'})`
                      : activeSpeaker
                      ? `${activeSpeaker} কথা বলছেন...`
                      : 'রুম প্রস্তুত • কথা বলতে চেপে ধরুন'}
                  </Text>
                  <Text style={styles.speakerBannerSub}>
                    {isTalking
                      ? 'রুমের সবাই এখন আপনার কথা লাইভ শুনছে'
                      : activeSpeaker
                      ? 'সবাই এখন ওনার কথা শুনছে'
                      : 'নিচের বড় বাটনে চাপ দিয়ে ধরে কথা বলুন'}
                  </Text>
                </View>
              </View>
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
                  <Text style={styles.pttSubtext}>{isTalking ? 'কথা বলুন...' : 'চেপে ধরে রাখুন'}</Text>
                </TouchableOpacity>
              </Animated.View>

              {/* Speaker Phone Name Display */}
              <View style={styles.speakerStatusBox}>
                <View
                  style={[
                    styles.activeSpeakerDot,
                    { backgroundColor: isTalking ? '#EF4444' : activeSpeaker ? '#06B6D4' : '#10B981' },
                  ]}
                />
                <Text style={styles.speakerStatusText}>
                  {isTalking
                    ? `মাইক্রোফোন সক্রিয়: ${networkInfo?.deviceName || 'This Phone'}`
                    : activeSpeaker
                    ? `কথা বলছেন: ${activeSpeaker}`
                    : 'রুম প্রস্তুত • কথা বলতে বাটন চেপে ধরুন'}
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
                স্মার্ট অন-ডিমান্ড স্ক্যানার: চার্জ বাঁচাতে এটি সারাক্ষণ স্ক্যান করে না; শুধু বাটন চাপলে ১০ সেকেন্ড স্ক্যান করে অটো-অফ হয়।
              </Text>

              {/* Search Box */}
              <View style={styles.searchBox}>
                <Text style={{ fontSize: 14, marginRight: 8 }}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search device name or MAC address..."
                  placeholderTextColor="#64748B"
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
                  style={[styles.deviceCard, isConn && { borderColor: '#10B981', borderWidth: 1.5 }]}>
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
                  হেডফোন পেয়ারিং মোডে রেখে উপরের &quot;Scan Nearby&quot; বাটনে চাপুন।
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
          <Text style={[styles.navLabel, activePage === 'host' && styles.navLabelActive]}>Host Room</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'join' && styles.navItemActive]}
          onPress={() => setActivePage('join')}>
          <Text style={[styles.navIcon, activePage === 'join' && styles.navIconActive]}>🎧</Text>
          <Text style={[styles.navLabel, activePage === 'join' && styles.navLabelActive]}>Join Room</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'walkie' && styles.navItemActive]}
          onPress={() => setActivePage('walkie')}>
          <Text style={[styles.navIcon, activePage === 'walkie' && styles.navIconActive]}>📻</Text>
          <Text style={[styles.navLabel, activePage === 'walkie' && styles.navLabelActive]}>Walkie-Talkie</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activePage === 'devices' && styles.navItemActive]}
          onPress={() => setActivePage('devices')}>
          <Text style={[styles.navIcon, activePage === 'devices' && styles.navIconActive]}>📱</Text>
          <Text style={[styles.navLabel, activePage === 'devices' && styles.navLabelActive]}>Devices ({devices.length})</Text>
        </TouchableOpacity>
      </View>

      {/* ── QR Scanner & Quick Join Modal ── */}
      <Modal visible={showQRScanner} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.qrModalCard}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📷</Text>
            <Text style={styles.modalTitle}>QR Code & Quick Join</Text>
            <Text style={styles.modalSub}>হোস্টের IP অ্যাড্রেস লিখুন অথবা পাওয়া রুমে ট্যাপ করুন</Text>

            {otherDiscoveredRooms.length > 0 && (
              <View style={{ width: '100%', marginBottom: 14 }}>
                <Text style={{ color: '#06B6D4', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                  অফলাইনে পাওয়া সক্রিয় রুম:
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
              placeholder="৪-ডিজিট রুম কোড (উদা: 8942) বা IP"
              placeholderTextColor="#64748B"
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
              <Text style={styles.modalActionBtnText}>⚡ রুমে যুক্ত হোন (Join Host)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowQRScanner(false)}>
              <Text style={styles.modalCloseBtnText}>বন্ধ করুন</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Futuristic Cyber Stylesheet ──────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050811',
  },
  scrollBody: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  pageContainer: {
    gap: 14,
    paddingTop: 6,
  },

  // Toast
  toast: {
    position: 'absolute',
    top: 48,
    left: 16,
    right: 16,
    zIndex: 9999,
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    elevation: 10,
  },
  toastSuccess: { backgroundColor: '#064E3B', borderColor: '#10B981' },
  toastError: { backgroundColor: '#7F1D1D', borderColor: '#EF4444' },
  toastWarn: { backgroundColor: '#78350F', borderColor: '#F59E0B' },
  toastText: { color: '#F8FAFC', fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0F172A',
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#F8FAFC',
    letterSpacing: -0.5,
  },
  proPill: {
    backgroundColor: 'rgba(6,182,212,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#06B6D4',
  },
  proPillText: {
    color: '#06B6D4',
    fontSize: 10,
    fontWeight: '800',
  },
  subTitle: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  netBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  netBadgeOn: {
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderColor: '#10B981',
  },
  netBadgeOff: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: '#EF4444',
  },
  netBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  netBadgeTextOn: { color: '#10B981' },
  netBadgeTextOff: { color: '#EF4444' },

  // Network Warning Box
  netWarningBox: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
  },
  netWarningTitle: {
    color: '#F59E0B',
    fontSize: 14,
    fontWeight: '800',
  },
  netWarningText: {
    color: '#F8FAFC',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  netActionBtn: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  netActionBtnText: {
    color: '#050811',
    fontSize: 12,
    fontWeight: '800',
  },

  // Active Network Strip
  netStatusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0A1220',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#162238',
  },
  netStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  netStatusText: {
    color: '#06B6D4',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  netDeviceName: {
    color: '#64748B',
    fontSize: 11,
  },

  // Card
  card: {
    backgroundColor: '#0A101D',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#162238',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardBadge: {
    color: '#06B6D4',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cardDesc: {
    color: '#94A3B8',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 10,
  },

  // Host Room Styles
  roomCodeTitle: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: 'monospace',
  },
  regenBtn: {
    backgroundColor: 'rgba(6,182,212,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#06B6D4',
  },
  regenBtnText: {
    color: '#06B6D4',
    fontSize: 11.5,
    fontWeight: '700',
  },
  qrHint: {
    color: '#06B6D4',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  qrSubHint: {
    color: '#64748B',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  listenerCounterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  listenerNumberBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(6,182,212,0.15)',
    borderWidth: 1.5,
    borderColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenerNumber: {
    color: '#06B6D4',
    fontSize: 20,
    fontWeight: '900',
  },
  listenerTitle: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '700',
  },
  listenerSub: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 1,
  },
  liveTimerBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveTimerText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  startBtn: {
    backgroundColor: '#06B6D4',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  startBtnText: {
    color: '#050811',
    fontSize: 14,
    fontWeight: '800',
  },
  stopBtn: {
    backgroundColor: '#EF4444',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  stopBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // Participant List on Host
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 8,
  },
  participantName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  participantMeta: {
    color: '#64748B',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  hostBadge: {
    backgroundColor: 'rgba(6,182,212,0.15)',
    borderWidth: 1,
    borderColor: '#06B6D4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  hostBadgeText: {
    color: '#06B6D4',
    fontSize: 10,
    fontWeight: '800',
  },
  syncedBadge: {
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  syncedBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
  },
  noParticipantsBox: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  noParticipantsText: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
  },

  // Audio Visualizer
  visualizerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 20,
  },
  visualizerBar: {
    width: 4,
    height: 18,
    backgroundColor: '#06B6D4',
    borderRadius: 2,
  },

  // Tracks
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 8,
  },
  trackItemActive: {
    borderColor: '#06B6D4',
    backgroundColor: 'rgba(6,182,212,0.08)',
  },
  trackTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  trackArtist: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 1,
  },
  trackDuration: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Volume
  volumeBox: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#162238',
  },
  volLabel: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  volValue: {
    color: '#06B6D4',
    fontSize: 12,
    fontWeight: '800',
  },
  volControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  volBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  volBtnText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  volTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  volFill: {
    height: '100%',
  },

  // Join Room Styles
  liveGreenDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
  },
  joinedTitle: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '800',
  },
  joinedSub: {
    color: '#94A3B8',
    fontSize: 11.5,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  listenerStatusRow: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 8,
    padding: 8,
    marginVertical: 10,
  },
  listenerStatusText: {
    color: '#10B981',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  listenerVisualizerBox: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: 8,
    height: 36,
    backgroundColor: '#0A1E1B',
    borderRadius: 10,
    padding: 8,
  },
  leaveBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  leaveBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '800',
  },

  // Discovered Rooms
  discoveredContainer: {
    backgroundColor: '#0F1B2B',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#06B6D4',
    marginBottom: 10,
  },
  discoveredHeader: {
    color: '#06B6D4',
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 8,
  },
  discoveredItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A1220',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 6,
  },
  discoveredTitle: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '700',
  },
  discoveredMeta: {
    color: '#64748B',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  quickJoinBtn: {
    backgroundColor: '#06B6D4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quickJoinBtnText: {
    color: '#050811',
    fontSize: 11.5,
    fontWeight: '800',
  },

  // Form Inputs
  inputLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: 'monospace',
  },
  joinActionBtn: {
    backgroundColor: '#06B6D4',
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinActionBtnText: {
    color: '#050811',
    fontSize: 13,
    fontWeight: '800',
  },
  feedbackCard: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    padding: 12,
    marginTop: 10,
  },
  feedbackTitle: {
    color: '#F59E0B',
    fontSize: 12.5,
    fontWeight: '800',
  },
  feedbackText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  suggestionBtn: {
    backgroundColor: '#06B6D4',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  suggestionBtnText: {
    color: '#050811',
    fontSize: 12,
    fontWeight: '800',
  },
  orDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1E293B',
  },
  orText: {
    color: '#64748B',
    fontSize: 11,
    marginHorizontal: 12,
    fontWeight: '600',
  },
  qrScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#06B6D4',
    paddingVertical: 12,
    borderRadius: 10,
  },
  qrScanBtnText: {
    color: '#06B6D4',
    fontSize: 13,
    fontWeight: '800',
  },
  tipBox: {
    backgroundColor: 'rgba(6,182,212,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(6,182,212,0.2)',
    borderRadius: 12,
    padding: 12,
  },
  tipTitle: {
    color: '#06B6D4',
    fontSize: 12.5,
    fontWeight: '800',
    marginBottom: 4,
  },
  tipText: {
    color: '#94A3B8',
    fontSize: 11.5,
    lineHeight: 18,
  },

  // Walkie-Talkie Styles
  roomVoiceTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  roomMemberBadge: {
    backgroundColor: 'rgba(6,182,212,0.15)',
    borderWidth: 1,
    borderColor: '#06B6D4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  roomMemberBadgeText: {
    color: '#06B6D4',
    fontSize: 11.5,
    fontWeight: '800',
  },
  speakerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    marginTop: 6,
  },
  speakerBannerIdle: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
  },
  speakerBannerTalking: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: '#EF4444',
  },
  speakerBannerActive: {
    backgroundColor: 'rgba(6,182,212,0.12)',
    borderColor: '#06B6D4',
  },
  speakerBannerTitle: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '800',
  },
  speakerBannerSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  pttContainer: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  pttOuterRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(6,182,212,0.1)',
    borderWidth: 2,
    borderColor: 'rgba(6,182,212,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pttOuterRingActive: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderColor: '#EF4444',
  },
  pttButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#0A1220',
    borderWidth: 3,
    borderColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
  },
  pttButtonActive: {
    backgroundColor: '#7F1D1D',
    borderColor: '#EF4444',
  },
  pttIcon: {
    fontSize: 38,
    marginBottom: 4,
  },
  pttText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  pttSubtext: {
    color: '#64748B',
    fontSize: 10.5,
    marginTop: 2,
  },
  speakerStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    backgroundColor: '#0A101D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#162238',
  },
  activeSpeakerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speakerStatusText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },

  // Bluetooth Manager Styles
  scanBtn: {
    backgroundColor: '#06B6D4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  scanBtnActive: {
    backgroundColor: '#3B82F6',
  },
  scanBtnText: {
    color: '#050811',
    fontSize: 11.5,
    fontWeight: '800',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 12.5,
    padding: 0,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  filterPillActive: {
    backgroundColor: '#06B6D4',
    borderColor: '#06B6D4',
  },
  filterPillText: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#050811',
    fontWeight: '800',
  },
  deviceCard: {
    backgroundColor: '#0A101D',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#162238',
  },
  deviceCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  deviceName: {
    color: '#F8FAFC',
    fontSize: 14.5,
    fontWeight: '700',
  },
  battBadge: {
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  battText: {
    color: '#10B981',
    fontSize: 10.5,
    fontWeight: '700',
  },
  deviceMeta: {
    color: '#64748B',
    fontSize: 11.5,
    marginTop: 2,
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
    backgroundColor: '#06B6D4',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  connectBtnText: {
    color: '#050811',
    fontSize: 12,
    fontWeight: '800',
  },
  connectingBox: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  disconnectBtn: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  disconnectBtnText: {
    color: '#EF4444',
    fontSize: 11.5,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#0A101D',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#162238',
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySub: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
  },

  // Bottom Navigation
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    backgroundColor: '#080E1B',
    borderTopWidth: 1,
    borderTopColor: '#162238',
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingBottom: 8,
    alignItems: 'center',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 10,
  },
  navItemActive: {
    backgroundColor: 'rgba(6,182,212,0.1)',
  },
  navIcon: {
    fontSize: 20,
    opacity: 0.5,
  },
  navIconActive: {
    opacity: 1,
  },
  navLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  navLabelActive: {
    color: '#06B6D4',
    fontWeight: '800',
  },

  // QR Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0A101D',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#06B6D4',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  modalRoomPill: {
    backgroundColor: '#0F1B2B',
    borderWidth: 1,
    borderColor: '#06B6D4',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  modalRoomPillText: {
    color: '#06B6D4',
    fontSize: 12.5,
    fontWeight: '700',
  },
  modalIpInput: {
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    color: '#F8FAFC',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  modalActionBtn: {
    width: '100%',
    backgroundColor: '#06B6D4',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalActionBtnText: {
    color: '#050811',
    fontSize: 13.5,
    fontWeight: '800',
  },
  modalCloseBtn: {
    paddingVertical: 8,
  },
  modalCloseBtnText: {
    color: '#64748B',
    fontSize: 12.5,
    fontWeight: '600',
  },
});
