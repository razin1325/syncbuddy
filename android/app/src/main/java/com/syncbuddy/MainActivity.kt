package com.syncbuddy

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Promise
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    companion object {
        const val MEDIA_PROJECTION_REQUEST = 9001

        // Held by SyncNetworkModule to resolve the JS promise after user allows/denies
        @Volatile
        var pendingProjectionPromise: Promise? = null

        @Volatile
        var instance: MainActivity? = null
    }

    override fun getMainComponentName(): String = "SyncBuddy"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    /**
     * Called by SyncNetworkModule to launch the system MediaProjection consent dialog.
     * The user sees "SyncBuddy will start capturing everything on your screen" → Allow.
     */
    fun requestMediaProjection(promise: Promise) {
        pendingProjectionPromise = promise
        val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(projectionManager.createScreenCaptureIntent(), MEDIA_PROJECTION_REQUEST)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == MEDIA_PROJECTION_REQUEST) {
            val promise = pendingProjectionPromise
            pendingProjectionPromise = null

            if (resultCode == Activity.RESULT_OK && data != null) {
                // Start the AudioCaptureService foreground service with the projection token
                val serviceIntent = Intent(this, com.syncbuddy.network.AudioCaptureService::class.java).apply {
                    putExtra(com.syncbuddy.network.AudioCaptureService.EXTRA_RESULT_CODE, resultCode)
                    putExtra(com.syncbuddy.network.AudioCaptureService.EXTRA_DATA, data)
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
                promise?.resolve(true)
            } else {
                promise?.reject("DENIED", "ইউজার অডিও ক্যাপচার অনুমতি দেননি")
            }
        }
    }
}
