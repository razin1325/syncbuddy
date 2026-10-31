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
    ): List<NativeModule> = listOf(
        BluetoothStateModule(reactContext),
        AuracastModule(reactContext),
        com.syncbuddy.network.SyncNetworkModule(reactContext)
    )

    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<*, *>> = emptyList()
}

