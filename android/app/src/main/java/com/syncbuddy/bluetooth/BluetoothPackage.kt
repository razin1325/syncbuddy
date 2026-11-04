package com.syncbuddy.bluetooth

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * BluetoothPackage
 *
 * Registers both native modules with React Native's bridge:
 *   - BluetoothStateModule  → real BT on/off detection + listener
 *   - AuracastModule        → LE Audio / Auracast broadcast control
 *
 * Add this package to MainApplication.kt:
 *   override fun getPackages() = listOf(BluetoothPackage(), ...)
 */
class BluetoothPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext
    ): List<NativeModule> {
        return try {
            listOf(
                BluetoothStateModule(reactContext),
                AuracastModule(reactContext),
                com.syncbuddy.network.SyncNetworkModule(reactContext)
            )
        } catch (t: Throwable) {
            android.util.Log.e("BluetoothPackage", "Error initializing native modules", t)
            emptyList()
        }
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> {
        return try {
            listOf(
                com.syncbuddy.media.Media3PlayerViewManager()
            )
        } catch (t: Throwable) {
            android.util.Log.e("BluetoothPackage", "Error initializing view managers", t)
            emptyList()
        }
    }
}

