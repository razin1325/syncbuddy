/**
 * NativeBluetooth.ts
 *
 * TypeScript bridge to the native Android BluetoothStateModule & AuracastModule.
 *
 * On Web preview (browser): all functions return safe mock values so the app
 * continues to run without crashing. Real values only come on an actual Android build.
 *
 * Usage in App.tsx:
 *   import { NativeBluetooth, NativeAuracast } from './NativeBluetooth';
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// ─── Bluetooth State ──────────────────────────────────────────────────────────

type BluetoothState = 'on' | 'off' | 'turning_on' | 'turning_off' | 'unavailable';

interface IBluetoothStateModule {
  getBluetoothState(): Promise<BluetoothState>;
  isBluetoothEnabled(): Promise<boolean>;
  isLeAudioSupported(): Promise<boolean>;
  requestEnableBluetooth(): Promise<boolean>;
  getBondedDevices(): Promise<Array<{ id: string; name: string; macAddress: string; type: string; status: string }>>;
  getDeviceName(): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/** Web / unbuilt-app safe mock */
const BluetoothStateMock: IBluetoothStateModule = {
  getBluetoothState: () => Promise.resolve('on'),
  isBluetoothEnabled: () => Promise.resolve(true),
  isLeAudioSupported: () => Promise.resolve(false),
  requestEnableBluetooth: () => Promise.resolve(true),
  getBondedDevices: () => Promise.resolve([]),
  getDeviceName: () => Promise.resolve('Redmi Mobile'),
  addListener: () => {},
  removeListeners: () => {},
};

const _BTStateNative: IBluetoothStateModule =
  Platform.OS === 'android' && NativeModules.BluetoothState
    ? (NativeModules.BluetoothState as IBluetoothStateModule)
    : BluetoothStateMock;

export const NativeBluetooth = _BTStateNative;

/** Subscribe to real-time BT adapter state changes from the OS */
export const createBluetoothStateEmitter = () => {
  if (Platform.OS === 'android' && NativeModules.BluetoothState) {
    return new NativeEventEmitter(NativeModules.BluetoothState);
  }
  return null;
};

// ─── Auracast (LE Audio Broadcast) ───────────────────────────────────────────

interface StartBroadcastResult {
  supported: boolean;
  success?: boolean;
  broadcastId?: number;
  reason?: string;
}

interface IAuracastModule {
  startBroadcast(broadcastName: string): Promise<StartBroadcastResult>;
  stopBroadcast(broadcastId: number): Promise<boolean>;
  getBroadcastStatus(): Promise<{ isActive: boolean; note?: string }>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const AuracastMock: IAuracastModule = {
  startBroadcast: () =>
    Promise.resolve({ supported: false, reason: 'Native build required' }),
  stopBroadcast: () => Promise.resolve(false),
  getBroadcastStatus: () =>
    Promise.resolve({ isActive: false, note: 'Native build required' }),
  addListener: () => {},
  removeListeners: () => {},
};

const _AuracastNative: IAuracastModule =
  Platform.OS === 'android' && NativeModules.Auracast
    ? (NativeModules.Auracast as IAuracastModule)
    : AuracastMock;

export const NativeAuracast = _AuracastNative;

export const createAuracastEmitter = () => {
  if (Platform.OS === 'android' && NativeModules.Auracast) {
    return new NativeEventEmitter(NativeModules.Auracast);
  }
  return null;
};

// ─── Auracast Event Names ─────────────────────────────────────────────────────
export const AURACAST_EVENTS = {
  BROADCAST_STARTED: 'auracastBroadcastStarted',
  BROADCAST_STOPPED: 'auracastBroadcastStopped',
  LISTENER_ADDED: 'auracastListenerAdded',
  LISTENER_REMOVED: 'auracastListenerRemoved',
  ERROR: 'auracastError',
} as const;

export const BT_EVENTS = {
  STATE_CHANGED: 'bluetoothStateChanged',
} as const;

export type { BluetoothState, StartBroadcastResult };

