package com.syncbuddy.bluetooth

import android.Manifest
import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * BluetoothStateModule
 *
 * Real-time hardware connection monitoring:
 * - Checks whether a device is ACTUALLY physically connected in Android OS.
 * - Listens for physical hardware ACL connect / disconnect events in real-time.
 * - Never shows inactive / powered-off devices as connected.
 */
class BluetoothStateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val MODULE_NAME = "BluetoothState"
        const val EVENT_STATE_CHANGED = "bluetoothStateChanged"
        const val EVENT_DEVICE_CONNECTION_CHANGED = "deviceConnectionChanged"
    }

    private var a2dpProfile: BluetoothProfile? = null
    private var headsetProfile: BluetoothProfile? = null

    private val bluetoothAdapter: BluetoothAdapter?
        get() {
            return try {
                val btManager =
                    reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
                btManager?.adapter
            } catch (t: Throwable) {
                null
            }
        }

    private val btStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            try {
                val action = intent?.action ?: return

                if (action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                    val state = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_STATE,
                        BluetoothAdapter.ERROR
                    )
                    sendEvent(EVENT_STATE_CHANGED, Arguments.createMap().apply {
                        putString("state", adapterStateToString(state))
                    })
                } else if (action == BluetoothDevice.ACTION_ACL_CONNECTED || action == BluetoothDevice.ACTION_ACL_DISCONNECTED) {
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    if (device != null) {
                        val isConn = (action == BluetoothDevice.ACTION_ACL_CONNECTED)
                        val battery = if (isConn) getDeviceBatteryLevel(device) else null
                        sendEvent(EVENT_DEVICE_CONNECTION_CHANGED, Arguments.createMap().apply {
                            putString("macAddress", device.address)
                            putString("name", device.name ?: "Bluetooth Device")
                            putBoolean("connected", isConn)
                            if (battery != null) putInt("battery", battery)
                        })
                    }
                } else if (action == BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED || action == BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED) {
                    val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED)
                    val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    if (device != null) {
                        val isConn = (state == BluetoothProfile.STATE_CONNECTED)
                        val battery = if (isConn) getDeviceBatteryLevel(device) else null
                        sendEvent(EVENT_DEVICE_CONNECTION_CHANGED, Arguments.createMap().apply {
                            putString("macAddress", device.address)
                            putString("name", device.name ?: "Bluetooth Device")
                            putBoolean("connected", isConn)
                            if (battery != null) putInt("battery", battery)
                        })
                    }
                }
            } catch (t: Throwable) {}
        }
    }

    override fun getName(): String = MODULE_NAME

    override fun initialize() {
        super.initialize()
        try {
            val filter = IntentFilter().apply {
                addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
                addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
                addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
                addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(btStateReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                reactContext.registerReceiver(btStateReceiver, filter)
            }

            // Register A2DP profile proxy
            bluetoothAdapter?.getProfileProxy(reactContext, object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    if (profile == BluetoothProfile.A2DP) a2dpProfile = proxy
                }
                override fun onServiceDisconnected(profile: Int) {
                    if (profile == BluetoothProfile.A2DP) a2dpProfile = null
                }
            }, BluetoothProfile.A2DP)

            // Register Headset profile proxy
            bluetoothAdapter?.getProfileProxy(reactContext, object : BluetoothProfile.ServiceListener {
                override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                    if (profile == BluetoothProfile.HEADSET) headsetProfile = proxy
                }
                override fun onServiceDisconnected(profile: Int) {
                    if (profile == BluetoothProfile.HEADSET) headsetProfile = null
                }
            }, BluetoothProfile.HEADSET)

        } catch (t: Throwable) {}
    }

    override fun invalidate() {
        super.invalidate()
        try {
            reactContext.unregisterReceiver(btStateReceiver)
        } catch (t: Throwable) {}
        try {
            if (a2dpProfile != null) {
                bluetoothAdapter?.closeProfileProxy(BluetoothProfile.A2DP, a2dpProfile)
            }
            if (headsetProfile != null) {
                bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HEADSET, headsetProfile)
            }
        } catch (t: Throwable) {}
    }

    private fun hasConnectPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        return ContextCompat.checkSelfPermission(
            reactContext,
            Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Accurately checks whether a Bluetooth device is physically connected and active.
     */
    private fun checkIsDeviceConnected(device: BluetoothDevice): Boolean {
        if (!hasConnectPermission()) return false
        return try {
            // Check A2DP proxy
            val a2dpList = a2dpProfile?.connectedDevices
            if (a2dpList != null && a2dpList.any { it.address.equals(device.address, ignoreCase = true) }) {
                return true
            }

            // Check Headset proxy
            val headsetList = headsetProfile?.connectedDevices
            if (headsetList != null && headsetList.any { it.address.equals(device.address, ignoreCase = true) }) {
                return true
            }

            // Check reflection isConnected()
            val method = device.javaClass.getMethod("isConnected")
            (method.invoke(device) as? Boolean) == true
        } catch (t: Throwable) {
            false
        }
    }

    private fun getDeviceBatteryLevel(device: BluetoothDevice): Int? {
        if (!hasConnectPermission()) return null
        return try {
            val method = device.javaClass.getMethod("getBatteryLevel")
            val lvl = method.invoke(device) as? Int
            if (lvl != null && lvl in 0..100) lvl else null
        } catch (t: Throwable) {
            null
        }
    }

    @ReactMethod
    fun getBluetoothState(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.resolve("unavailable")
                return
            }
            if (!hasConnectPermission()) {
                promise.resolve(if (adapter.isEnabled) "on" else "off")
                return
            }
            promise.resolve(adapterStateToString(adapter.state))
        } catch (t: Throwable) {
            promise.resolve("on")
        }
    }

    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.resolve(false)
                return
            }
            promise.resolve(adapter.isEnabled)
        } catch (t: Throwable) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestEnableBluetooth(promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null) {
                promise.resolve(false)
                return
            }
            if (adapter.isEnabled) {
                promise.resolve(true)
                return
            }
            val intent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isLeAudioSupported(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                val adapter = bluetoothAdapter
                val method = adapter?.javaClass?.getMethod("isLeAudioSupported")
                val result = method?.invoke(adapter)
                promise.resolve(result == 10 || result == true)
            } catch (t: Throwable) {
                promise.resolve(false)
            }
        } else {
            promise.resolve(false)
        }
    }

    /**
     * Checks if a specific device is physically connected to the phone.
     */
    @ReactMethod
    fun isDeviceConnected(macAddress: String, promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null || !hasConnectPermission()) {
                promise.resolve(false)
                return
            }
            val dev = adapter.getRemoteDevice(macAddress)
            if (dev == null) {
                promise.resolve(false)
                return
            }
            val connected = checkIsDeviceConnected(dev)
            promise.resolve(connected)
        } catch (t: Throwable) {
            promise.resolve(false)
        }
    }

    /**
     * Triggers hardware connection to a paired device.
     */
    @ReactMethod
    fun connectDevice(macAddress: String, promise: Promise) {
        try {
            val adapter = bluetoothAdapter
            if (adapter == null || !hasConnectPermission()) {
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", false)
                    putBoolean("isConnected", false)
                    putString("message", "Bluetooth permission required")
                })
                return
            }
            val dev = adapter.getRemoteDevice(macAddress)
            if (dev == null) {
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", false)
                    putBoolean("isConnected", false)
                    putString("message", "Device not found")
                })
                return
            }

            // If already connected
            if (checkIsDeviceConnected(dev)) {
                val battery = getDeviceBatteryLevel(dev)
                promise.resolve(Arguments.createMap().apply {
                    putBoolean("success", true)
                    putBoolean("isConnected", true)
                    if (battery != null) putInt("battery", battery)
                    putString("message", "Device is active and connected")
                })
                return
            }

            // Try to trigger A2DP connect via reflection
            var connectInvoked = false
            if (a2dpProfile != null) {
                try {
                    val method = a2dpProfile?.javaClass?.getMethod("connect", BluetoothDevice::class.java)
                    method?.isAccessible = true
                    method?.invoke(a2dpProfile, dev)
                    connectInvoked = true
                } catch (t: Throwable) {}
            }

            promise.resolve(Arguments.createMap().apply {
                putBoolean("success", connectInvoked)
                putBoolean("isConnected", checkIsDeviceConnected(dev))
                putString("message", if (connectInvoked) "Connection requested" else "Headphone is not turned on")
            })
        } catch (t: Throwable) {
            promise.resolve(Arguments.createMap().apply {
                putBoolean("success", false)
                putBoolean("isConnected", false)
                putString("message", t.message ?: "Connect error")
            })
        }
    }

    /**
     * Returns paired devices with TRUE active connection state.
     * Inactive devices will have status = "Paired" (never fake "Connected").
     */
    @ReactMethod
    fun getBondedDevices(promise: Promise) {
        try {
            val array = Arguments.createArray()
            val adapter = bluetoothAdapter
            if (adapter == null || !hasConnectPermission()) {
                promise.resolve(array)
                return
            }
            val bonded = adapter.bondedDevices
            bonded?.forEach { device ->
                val isConn = checkIsDeviceConnected(device)
                val battery = if (isConn) getDeviceBatteryLevel(device) else null
                val map = Arguments.createMap().apply {
                    putString("id", device.address)
                    putString("name", device.name ?: "Bluetooth Device")
                    putString("macAddress", device.address)
                    putString("type", "Audio")
                    putString("status", if (isConn) "Connected" else "Paired")
                    putBoolean("isConnected", isConn)
                    if (battery != null) putInt("battery", battery)
                }
                array.pushMap(map)
            }
            promise.resolve(array)
        } catch (t: Throwable) {
            promise.resolve(Arguments.createArray())
        }
    }

    @ReactMethod
    fun getDeviceName(promise: Promise) {
        try {
            val name = if (hasConnectPermission()) bluetoothAdapter?.name else null
            promise.resolve(name ?: Build.MODEL ?: "Android Device")
        } catch (t: Throwable) {
            promise.resolve(Build.MODEL ?: "Android Device")
        }
    }

    @ReactMethod
    fun addListener(eventName: String?) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    private fun adapterStateToString(state: Int): String = when (state) {
        BluetoothAdapter.STATE_ON          -> "on"
        BluetoothAdapter.STATE_OFF         -> "off"
        BluetoothAdapter.STATE_TURNING_ON  -> "turning_on"
        BluetoothAdapter.STATE_TURNING_OFF -> "turning_off"
        else                               -> "unavailable"
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (t: Throwable) {}
    }
}
