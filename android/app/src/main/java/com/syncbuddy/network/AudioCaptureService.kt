package com.syncbuddy.network

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface

/**
 * AudioCaptureService
 *
 * Foreground service capturing internal audio (Spotify, YouTube, etc.)
 * using Android 10+ AudioPlaybackCapture API and broadcasting over UDP.
 */
class AudioCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "syncbuddy_audio_capture"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        const val AUDIO_STREAM_PORT = 8945
        const val SAMPLE_RATE = 44100
        const val AUDIO_BUFFER_SIZE = 1024

        @Volatile
        var isCapturing = false
            private set

        @Volatile
        var activeProjectionResultCode: Int = 0

        @Volatile
        var activeProjectionData: Intent? = null
    }

    private var mediaProjection: MediaProjection? = null
    private var audioRecord: AudioRecord? = null
    private var captureThread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            // 1. Immediately start as foreground to avoid Android 14 ANR / FGS crash
            val notification = buildNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }

            // 2. Retrieve MediaProjection token from memory or intent
            val resultCode = if (activeProjectionResultCode != 0) activeProjectionResultCode else intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
            val data = activeProjectionData ?: intent?.let {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    it.getParcelableExtra(EXTRA_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    it.getParcelableExtra(EXTRA_DATA)
                }
            }

            if (resultCode == -1 || data == null) {
                stopSelf()
                return START_NOT_STICKY
            }

            val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
            if (projectionManager == null) {
                stopSelf()
                return START_NOT_STICKY
            }

            mediaProjection = projectionManager.getMediaProjection(resultCode, data)
            if (mediaProjection == null) {
                stopSelf()
                return START_NOT_STICKY
            }

            startCapture()
            return START_STICKY
        } catch (t: Throwable) {
            android.util.Log.e("AudioCaptureService", "Fatal error in onStartCommand", t)
            stopSelf()
            return START_NOT_STICKY
        }
    }

    private fun startCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || mediaProjection == null) {
            stopSelf()
            return
        }

        try {
            // Register mandatory callback on Android 14+
            mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stopSelf()
                }
            }, android.os.Handler(android.os.Looper.getMainLooper()))

            val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()

            // Try native 44100 first, fallback to 48000
            val candidateRates = intArrayOf(SAMPLE_RATE, 48000)
            var initializedRecord: AudioRecord? = null

            for (sr in candidateRates) {
                try {
                    val minBuf = AudioRecord.getMinBufferSize(
                        sr,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT
                    )
                    if (minBuf <= 0) continue

                    val rec = AudioRecord.Builder()
                        .setAudioPlaybackCaptureConfig(config)
                        .setAudioFormat(
                            AudioFormat.Builder()
                                .setSampleRate(sr)
                                .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build()
                        )
                        .setBufferSizeInBytes(Math.max(minBuf, AUDIO_BUFFER_SIZE * 4))
                        .build()

                    if (rec.state == AudioRecord.STATE_INITIALIZED) {
                        initializedRecord = rec
                        break
                    } else {
                        rec.release()
                    }
                } catch (e: Exception) {
                    // Try next
                }
            }

            if (initializedRecord == null) {
                android.util.Log.e("AudioCaptureService", "Could not initialize AudioRecord for AudioPlaybackCapture")
                stopSelf()
                return
            }

            audioRecord = initializedRecord
            audioRecord?.startRecording()
            isCapturing = true

            captureThread = Thread {
                val pcm = ByteArray(AUDIO_BUFFER_SIZE)
                val packetBuf = ByteArray(AUDIO_BUFFER_SIZE + 4)
                packetBuf[0] = 'S'.code.toByte()
                packetBuf[1] = 'B'.code.toByte()
                packetBuf[2] = 'U'.code.toByte()
                packetBuf[3] = 'D'.code.toByte()

                try {
                    DatagramSocket().use { sendSocket ->
                        sendSocket.broadcast = true

                        while (isCapturing && audioRecord != null) {
                            val read = audioRecord?.read(pcm, 0, pcm.size) ?: -1
                            if (read > 0) {
                                System.arraycopy(pcm, 0, packetBuf, 4, read)
                                val targets = SyncNetworkModule.getBroadcastTargets()
                                for (target in targets) {
                                    try {
                                        val packet = DatagramPacket(packetBuf, read + 4, target, AUDIO_STREAM_PORT)
                                        sendSocket.send(packet)
                                    } catch (e: Exception) {}
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            captureThread?.start()
        } catch (t: Throwable) {
            android.util.Log.e("AudioCaptureService", "Error during startCapture", t)
            stopSelf()
        }
    }

    override fun onDestroy() {
        isCapturing = false
        activeProjectionData = null
        activeProjectionResultCode = 0

        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {}
        audioRecord = null

        try {
            mediaProjection?.stop()
        } catch (e: Exception) {}
        mediaProjection = null

        captureThread = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "SyncBuddy Audio Broadcast",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "লাইভ অডিও ব্রডকাস্ট চলছে"
                    setShowBadge(false)
                }
                val manager = getSystemService(NotificationManager::class.java)
                manager?.createNotificationChannel(channel)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun buildNotification(): Notification {
        // Guaranteed valid small icon from applicationInfo to prevent BadForegroundServiceNotificationException
        val iconRes = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.sym_def_app_icon
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SyncBuddy • লাইভ অডিও ব্রডকাস্ট")
            .setContentText("আপনার ফোনের মিউজিক সবার হেডফোনে স্ট্রিম হচ্ছে")
            .setSmallIcon(iconRes)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }
}
