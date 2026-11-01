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
        const val AUDIO_PICKER_REQUEST = 9002

        @Volatile
        var pendingProjectionPromise: Promise? = null

        @Volatile
        var pendingAudioPickerPromise: Promise? = null

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

    fun requestMediaProjection(promise: Promise) {
        pendingProjectionPromise = promise
        try {
            val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            if (projectionManager != null) {
                startActivityForResult(projectionManager.createScreenCaptureIntent(), MEDIA_PROJECTION_REQUEST)
            } else {
                promise.reject("ERR_PROJECTION", "MediaProjectionManager is unavailable")
            }
        } catch (e: Exception) {
            promise.reject("ERR_PROJECTION_INIT", e.message)
        }
    }

    fun requestAudioFilePicker(promise: Promise) {
        pendingAudioPickerPromise = promise
        try {
            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                type = "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*"))
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            startActivityForResult(Intent.createChooser(intent, "অডিও বা ভিডিও ফাইল নির্বাচন করুন"), AUDIO_PICKER_REQUEST)
        } catch (e: Exception) {
            promise.reject("ERR_PICKER", e.message)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == AUDIO_PICKER_REQUEST) {
            val promise = pendingAudioPickerPromise
            pendingAudioPickerPromise = null
            if (resultCode == Activity.RESULT_OK && data?.data != null) {
                val uri = data.data!!
                var fileName = "Music File"
                try {
                    contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (nameIndex != -1 && cursor.moveToFirst()) {
                            fileName = cursor.getString(nameIndex) ?: "Music File"
                        }
                    }
                } catch (e: Exception) {}

                val map = com.facebook.react.bridge.Arguments.createMap()
                map.putString("uri", uri.toString())
                map.putString("name", fileName)
                promise?.resolve(map)
            } else {
                promise?.reject("CANCELLED", "কোনো গান নির্বাচন করা হয়নি")
            }
            return
        }

        if (requestCode == MEDIA_PROJECTION_REQUEST) {
            val promise = pendingProjectionPromise
            pendingProjectionPromise = null

            if (resultCode == Activity.RESULT_OK && data != null) {
                // Pass directly to the companion object to bypass Intent parcelable limits on Android 14
                com.syncbuddy.network.AudioCaptureService.activeProjectionResultCode = resultCode
                com.syncbuddy.network.AudioCaptureService.activeProjectionData = data

                try {
                    val serviceIntent = Intent(this, com.syncbuddy.network.AudioCaptureService::class.java).apply {
                        putExtra(com.syncbuddy.network.AudioCaptureService.EXTRA_RESULT_CODE, resultCode)
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(serviceIntent)
                    } else {
                        startService(serviceIntent)
                    }
                    promise?.resolve(true)
                } catch (e: Exception) {
                    android.util.Log.e("MainActivity", "Failed to start AudioCaptureService", e)
                    promise?.reject("ERR_START_SERVICE", e.message)
                }
            } else {
                promise?.reject("DENIED", "ইউজার অডিও ক্যাপচার অনুমতি দেননি")
            }
        }
    }
}
