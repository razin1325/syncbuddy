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
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * AudioCaptureService
 *
 * A foreground service that captures all internal/system audio output
 * (Spotify, YouTube, any music player) using Android 10's AudioPlaybackCapture API,
 * and broadcasts it over LAN via UDP to all connected listeners.
 *
 * Flow:
 * 1. User taps "Start Live Audio Broadcast" in the app
 * 2. Android shows a MediaProjection consent dialog ("Allow SyncBuddy to record?")
 * 3. User taps "Allow" → service starts, captures system audio, streams over UDP
 * 4. All listeners on same Wi-Fi/Hotspot hear the host's music in real time
 */
class AudioCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "syncbuddy_audio_capture"
        const val NOTIFICATION_ID = 1001
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        const val AUDIO_STREAM_PORT = 8945
        const val SAMPLE_RATE = 16000
        const val AUDIO_BUFFER_SIZE = 1024

        @Volatile
        var isCapturing = false
            private set

        // Peers to broadcast to (shared with SyncNetworkModule)
        val knownPeerIps = mutableSetOf<String>()
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
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
        val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_DATA)
        }

        if (resultCode == -1 || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        // Start as foreground immediately (Android requires this within 5 seconds)
        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        // Get MediaProjection from the result
        val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, data)

        if (mediaProjection == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startCapture()
        return START_STICKY
    }

    private fun startCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // AudioPlaybackCapture requires Android 10+
            stopSelf()
            return
        }

        try {
            val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection!!)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()

            val minBuf = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )

            audioRecord = AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(config)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build()
                )
                .setBufferSizeInBytes(Math.max(minBuf, AUDIO_BUFFER_SIZE * 4))
                .build()

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                stopSelf()
                return
            }

            audioRecord?.startRecording()
            isCapturing = true

            captureThread = Thread {
                val pcm = ByteArray(AUDIO_BUFFER_SIZE)
                val packetBuf = ByteArray(AUDIO_BUFFER_SIZE + 4)
                // SyncBuddy UDP header: "SBUD"
                packetBuf[0] = 'S'.code.toByte()
                packetBuf[1] = 'B'.code.toByte()
                packetBuf[2] = 'U'.code.toByte()
                packetBuf[3] = 'D'.code.toByte()

                try {
                    DatagramSocket().use { sendSocket ->
                        sendSocket.broadcast = true

                        while (isCapturing && audioRecord != null) {
                            val read = audioRecord!!.read(pcm, 0, pcm.size)
                            if (read > 0) {
                                System.arraycopy(pcm, 0, packetBuf, 4, read)
                                val targets = getBroadcastTargets()
                                for (target in targets) {
                                    try {
                                        val packet = DatagramPacket(packetBuf, read + 4, target, AUDIO_STREAM_PORT)
                                        sendSocket.send(packet)
                                    } catch (e: Exception) { /* ignore send errors */ }
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            captureThread?.start()

        } catch (e: Exception) {
            e.printStackTrace()
            stopSelf()
        }
    }

    private fun getBroadcastTargets(): List<InetAddress> {
        val targets = mutableListOf<InetAddress>()
        try {
            targets.add(InetAddress.getByName("255.255.255.255"))
        } catch (e: Exception) {}

        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces != null && interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                for (ia in iface.interfaceAddresses) {
                    val bcast = ia.broadcast
                    if (bcast != null && !targets.contains(bcast)) {
                        targets.add(bcast)
                    }
                }
            }
        } catch (e: Exception) {}

        // Also send directly to known peers (bypasses router AP isolation)
        for (peerIp in knownPeerIps) {
            try {
                val addr = InetAddress.getByName(peerIp)
                if (!targets.contains(addr)) {
                    targets.add(addr)
                }
            } catch (e: Exception) {}
        }

        return targets
    }

    override fun onDestroy() {
        isCapturing = false
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
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SyncBuddy • লাইভ অডিও ব্রডকাস্ট")
            .setContentText("আপনার ফোনের মিউজিক সবার হেডফোনে স্ট্রিম হচ্ছে")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }
}

