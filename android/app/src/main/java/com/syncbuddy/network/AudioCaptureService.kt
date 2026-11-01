package com.syncbuddy.network

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
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
        const val SAMPLE_RATE = 48000
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

            val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            val nativeRate = audioManager?.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull() ?: SAMPLE_RATE
            val candidateRates = intArrayOf(SAMPLE_RATE, nativeRate, 44100)
            val channelConfigs = intArrayOf(AudioFormat.CHANNEL_IN_STEREO, AudioFormat.CHANNEL_IN_MONO)
            var initializedRecord: AudioRecord? = null
            var isStereoCapture = false

            for (ch in channelConfigs) {
                for (sr in candidateRates) {
                    try {
                        val minBuf = AudioRecord.getMinBufferSize(
                            sr,
                            ch,
                            AudioFormat.ENCODING_PCM_16BIT
                        )
                        if (minBuf <= 0) continue

                        val rec = AudioRecord.Builder()
                            .setAudioPlaybackCaptureConfig(config)
                            .setAudioFormat(
                                AudioFormat.Builder()
                                    .setSampleRate(sr)
                                    .setChannelMask(ch)
                                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                    .build()
                            )
                            .setBufferSizeInBytes(Math.max(minBuf, AUDIO_BUFFER_SIZE * 8))
                            .build()

                        if (rec.state == AudioRecord.STATE_INITIALIZED) {
                            initializedRecord = rec
                            isStereoCapture = (ch == AudioFormat.CHANNEL_IN_STEREO)
                            break
                        } else {
                            rec.release()
                        }
                    } catch (e: Exception) {}
                }
                if (initializedRecord != null) break
            }

            // Reliable fallback to MIC if playback capture is blocked by vendor or app
            if (initializedRecord == null) {
                android.util.Log.w("AudioCaptureService", "Playback capture unavailable, falling back to MIC")
                try {
                    val minBuf = AudioRecord.getMinBufferSize(
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT
                    )
                    val micRec = AudioRecord(
                        android.media.MediaRecorder.AudioSource.MIC,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(minBuf, AUDIO_BUFFER_SIZE * 4)
                    )
                    if (micRec.state == AudioRecord.STATE_INITIALIZED) {
                        initializedRecord = micRec
                        isStereoCapture = false
                    }
                } catch (e: Exception) {}
            }

            if (initializedRecord == null) {
                android.util.Log.e("AudioCaptureService", "Could not initialize any AudioRecord source")
                stopSelf()
                return
            }

            audioRecord = initializedRecord
            audioRecord?.startRecording()
            isCapturing = true

            captureThread = Thread {
                val shortBufferSize = if (isStereoCapture) 480 * 2 else 480
                val shortBuf = ShortArray(shortBufferSize)
                val packetBuf = ByteArray(480 * 2 + 8) // 968 bytes
                packetBuf[0] = 'S'.code.toByte()
                packetBuf[1] = 'B'.code.toByte()
                packetBuf[2] = 'U'.code.toByte()
                packetBuf[3] = 'D'.code.toByte()
                packetBuf[6] = 3.toByte() // 3 = system audio
                packetBuf[7] = 2.toByte() // v2

                var consecutiveSilentFrames = 0
                var currentRecord = audioRecord
                var seq = 0

                try {
                    DatagramSocket().use { sendSocket ->
                        sendSocket.broadcast = true

                        while (isCapturing && currentRecord != null) {
                            val shortsRead = currentRecord?.read(shortBuf, 0, shortBuf.size) ?: -1
                            if (shortsRead <= 0) {
                                Thread.sleep(10)
                                continue
                            }

                            // Check if this frame is pure silence (all zeroes)
                            var hasSignal = false
                            for (i in 0 until shortsRead) {
                                if (shortBuf[i] != 0.toShort()) {
                                    hasSignal = true
                                    break
                                }
                            }

                            if (!hasSignal) {
                                consecutiveSilentFrames++
                                // If 120 consecutive frames (~1.2 seconds) are completely silent zeroes,
                                // the media player app has blocked AudioPlaybackCapture.
                                // Auto-fallback to MIC so listeners hear the music!
                                if (consecutiveSilentFrames == 120) {
                                    android.util.Log.w("AudioCaptureService", "App blocked AudioPlaybackCapture, auto-switching to MIC fallback")
                                    try {
                                        val minBuf = AudioRecord.getMinBufferSize(
                                            SAMPLE_RATE,
                                            AudioFormat.CHANNEL_IN_MONO,
                                            AudioFormat.ENCODING_PCM_16BIT
                                        )
                                        val mic = AudioRecord(
                                            MediaRecorder.AudioSource.MIC,
                                            SAMPLE_RATE,
                                            AudioFormat.CHANNEL_IN_MONO,
                                            AudioFormat.ENCODING_PCM_16BIT,
                                            Math.max(minBuf, 2048)
                                        )
                                        if (mic.state == AudioRecord.STATE_INITIALIZED) {
                                            mic.startRecording()
                                            try { currentRecord?.stop(); currentRecord?.release() } catch (e: Exception) {}
                                            currentRecord = mic
                                            isStereoCapture = false
                                        }
                                    } catch (e: Exception) {
                                        e.printStackTrace()
                                    }
                                }
                            } else {
                                consecutiveSilentFrames = 0
                            }

                            val bytesToSend: Int
                            if (isStereoCapture) {
                                val frames = shortsRead / 2
                                for (i in 0 until frames) {
                                    val monoSample = ((shortBuf[i * 2].toInt() + shortBuf[i * 2 + 1].toInt()) / 2).toShort()
                                    val byteIdx = 8 + i * 2
                                    packetBuf[byteIdx] = (monoSample.toInt() and 0xFF).toByte()
                                    packetBuf[byteIdx + 1] = ((monoSample.toInt() shr 8) and 0xFF).toByte()
                                }
                                bytesToSend = frames * 2
                            } else {
                                for (i in 0 until shortsRead) {
                                    val sample = shortBuf[i]
                                    val byteIdx = 8 + i * 2
                                    packetBuf[byteIdx] = (sample.toInt() and 0xFF).toByte()
                                    packetBuf[byteIdx + 1] = ((sample.toInt() shr 8) and 0xFF).toByte()
                                }
                                bytesToSend = shortsRead * 2
                            }

                            packetBuf[4] = ((seq shr 8) and 0xFF).toByte()
                            packetBuf[5] = (seq and 0xFF).toByte()
                            seq = (seq + 1) and 0xFFFF

                            val targets = SyncNetworkModule.getAudioStreamTargets()
                            for (target in targets) {
                                try {
                                    val packet = DatagramPacket(packetBuf, bytesToSend + 8, target, AUDIO_STREAM_PORT)
                                    sendSocket.send(packet)
                                } catch (e: Exception) {}
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

    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            SyncNetworkModule.dismissAllNotifications(this)
            stopSelf()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        super.onTaskRemoved(rootIntent)
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
        try {
            SyncNetworkModule.dismissAllNotifications(this)
        } catch (e: Exception) {}
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
