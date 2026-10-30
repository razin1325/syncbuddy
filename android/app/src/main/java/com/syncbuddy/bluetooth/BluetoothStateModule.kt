package com.syncbuddy.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * BluetoothStateModule
 *
 * Exposes the Android BluetoothAdapter state to React Native JS layer.
 * Provides:
 *   - getBluetoothState()       → Promise<"on"|"off"|"turning_on"|"turning_off"|"unavailable">
 *   - addBluetoothStateListener → JS event "bluetoothStateChanged"
 *
 * Used by App.tsx to show the real BT ON/OFF state instead of a fake toggle.
 */
class BluetoothStateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "BluetoothState"
        const val EVENT_STATE_CHANGED = "bluetoothStateChanged"
    }

    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        val btManager =
            reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        btManager?.adapter
    }

    /** Broadcast receiver that fires whenever the system BT adapter state changes */
    private val btStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                val state = intent.getIntExtra(
                    BluetoothAdapter.EXTRA_STATE,
                    BluetoothAdapter.ERROR
                )
                val stateStr = adapterStateToString(state)
                sendEvent(EVENT_STATE_CHANGED, stateStr)
            }
        }
    }

    override fun getName(): String = MODULE_NAME

    override fun initialize() {
        super.initialize()
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        reactContext.registerReceiver(btStateReceiver, filter)
    }

    override fun invalidate() {
        super.invalidate()
        try {
            reactContext.unregisterReceiver(btStateReceiver)
        } catch (_: Exception) {}
    }

    /** Called from JS: BluetoothState.getBluetoothState() */
    @ReactMethod
    fun getBluetoothState(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.resolve("unavailable")
                return
            }
            promise.resolve(adapterStateToString(adapter.state))
        } catch (e: Exception) {
            promise.reject("BT_ERROR", e.message, e)
        }
    }

    /** Called from JS: BluetoothState.isBluetoothEnabled() → Promise<boolean> */
    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        try {
            promise.resolve(bluetoothAdapter?.isEnabled == true)
        } catch (e: Exception) {
            promise.reject("BT_ERROR", e.message, e)
        }
    }

    /**
     * Request system dialog to turn Bluetooth ON.
     * Launches Android system dialog: "SyncBuddy wants to turn on Bluetooth. [Allow]"
     */
    @ReactMethod
    fun requestEnableBluetooth(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.reject("NO_ADAPTER", "Bluetooth not supported on this device")
                return
            }
            if (adapter.isEnabled) {
                promise.resolve(true)
                return
            }
            val intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ENABLE_ERROR", e.message, e)
        }
    }

    /** Called from JS to check LE Audio / Auracast hardware support */
    @ReactMethod
    fun isLeAudioSupported(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { // API 33 = Android 13
            val supported = bluetoothAdapter?.isLeAudioSupported == BluetoothAdapter.STATE_CONNECTED
            promise.resolve(supported)
        } else {
            promise.resolve(false)
        }
    }

    /**
     * Get real bonded (paired) devices from the Android system.
     * Returns list of devices already paired in phone's Settings.
     */
    @ReactMethod
    fun getBondedDevices(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.resolve(Arguments.createArray())
                return
            }
            val bonded = adapter.bondedDevices
            val array = Arguments.createArray()
            bonded?.forEach { device ->
                val map = Arguments.createMap()
                map.putString("id", device.address)
                map.putString("name", device.name ?: "Bluetooth Device")
                map.putString("macAddress", device.address)
                map.putString("type", "Audio")
                map.putString("status", "Paired")
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("BONDED_ERROR", e.message, e)
        }
    }

    /** Get user's phone Bluetooth name (e.g. "Redmi Note") */
    @ReactMethod
    fun getDeviceName(promise: Promise) {
        try {
            val name = bluetoothAdapter?.name ?: Build.MODEL ?: "Android Device"
            promise.resolve(name)
        } catch (e: Exception) {
            promise.resolve(Build.MODEL ?: "Android Device")
        }
    }

    /** JS can call this to add a listener (required boilerplate for RN 0.65+) */
    @ReactMethod
    fun addListener(eventName: String) { /* required */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* required */ }

    // ── helpers ────────────────────────────────────────────────────────────

    private fun adapterStateToString(state: Int): String = when (state) {
        BluetoothAdapter.STATE_ON          -> "on"
        BluetoothAdapter.STATE_OFF         -> "off"
        BluetoothAdapter.STATE_TURNING_ON  -> "turning_on"
        BluetoothAdapter.STATE_TURNING_OFF -> "turning_off"
        else                               -> "unavailable"
    }

    private fun sendEvent(eventName: String, payload: String) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, payload)
    }
}

