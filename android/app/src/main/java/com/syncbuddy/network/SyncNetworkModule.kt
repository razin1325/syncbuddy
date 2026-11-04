package com.syncbuddy.network

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * SyncNetworkModule
 *
 * Real Offline LAN Peer-to-Peer Communication for SyncBuddy:
 * 1. Local IP & Hotspot/Wi-Fi Detection
 * 2. Real ServerSocket HTTP Server on Port 8942
 * 3. UDP Broadcast Beacon & Discovery on Port 8943
 * 4. Real-time participant notifications & Walkie-Talkie (PTT) relay
 */
class SyncNetworkModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SyncNetworkModule"

    override fun initialize() {
        super.initialize()
        try {
            // Surface Media3 decode/container failures to the React layer so the
            // UI can offer "open in another player" instead of failing silently.
            com.syncbuddy.media.Media3Manager.onPlaybackError = { code, message, uri ->
                val event = Arguments.createMap()
                event.putInt("errorCode", code)
                event.putString("message", message)
                event.putString("uri", uri ?: "")
                sendEvent(EVENT_MEDIA_ERROR, event)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    companion object {
        const val DEFAULT_HTTP_PORT = 8942
        const val DISCOVERY_PORT = 8943
        const val AUDIO_STREAM_PORT = 8945
        const val SAMPLE_RATE = 48000
        const val AUDIO_BUFFER_SIZE = 1024
        const val BEACON_PREFIX = "SYNCBUDDY_BEACON|"

        const val EVENT_LISTENER_JOINED = "ON_LISTENER_JOINED"
        const val EVENT_LISTENER_LEFT = "ON_LISTENER_LEFT"
        const val EVENT_PTT_MESSAGE = "ON_PTT_MESSAGE"
        const val EVENT_ROOM_DISCOVERED = "ON_ROOM_DISCOVERED"
        const val EVENT_BROADCAST_STATE = "ON_BROADCAST_STATE"
        const val EVENT_MEDIA_ERROR = "ON_MEDIA_ERROR"

        const val STATUS_NOTIFICATION_CHANNEL_ID = "syncbuddy_status_channel"
        const val STATUS_NOTIFICATION_NAME = "SyncBuddy Service Status"
        const val STATUS_NOTIFICATION_ID = 89421

        val knownPeerIps = ConcurrentHashMap.newKeySet<String>()
        val participantIps = ConcurrentHashMap.newKeySet<String>()

        fun dismissAllNotifications(context: Context) {
            try {
                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                manager?.cancel(STATUS_NOTIFICATION_ID)
                manager?.cancel(AudioCaptureService.NOTIFICATION_ID)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        fun getBroadcastTargets(): List<InetAddress> {
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

            for (peerIp in knownPeerIps) {
                try {
                    val addr = InetAddress.getByName(peerIp)
                    if (!targets.contains(addr)) {
                        targets.add(addr)
                    }
                } catch (e: Exception) {}
            }

            for (peerIp in participantIps) {
                try {
                    val addr = InetAddress.getByName(peerIp)
                    if (!targets.contains(addr)) {
                        targets.add(addr)
                    }
                } catch (e: Exception) {}
            }

            return targets
        }

        fun getAudioStreamTargets(): List<InetAddress> {
            val targets = mutableListOf<InetAddress>()
            // 1. If we have known connected listeners, send UNICAST directly to each listener.
            // Wi-Fi 802.11 unicast provides hardware ACK, avoids multicast queue drops, and eliminates duplicates.
            val peers = ArrayList(knownPeerIps)
            if (peers.isNotEmpty()) {
                for (peerIp in peers) {
                    try {
                        targets.add(InetAddress.getByName(peerIp))
                    } catch (e: Exception) {}
                }
                return targets
            }

            // 2. If no peers registered yet, broadcast to the local subnet ONLY (never both subnet and 255.255.255.255)
            try {
                val interfaces = NetworkInterface.getNetworkInterfaces()
                while (interfaces != null && interfaces.hasMoreElements()) {
                    val iface = interfaces.nextElement()
                    if (iface.isLoopback || !iface.isUp) continue
                    for (ia in iface.interfaceAddresses) {
                        val bcast = ia.broadcast
                        if (bcast != null) {
                            targets.add(bcast)
                            return targets
                        }
                    }
                }
            } catch (e: Exception) {}

            try {
                targets.add(InetAddress.getByName("255.255.255.255"))
            } catch (e: Exception) {}

            return targets
        }
    }

    // Audio Receiver & Player State (Plays incoming stream on phone/headphones)
    private var audioTrack: AudioTrack? = null
    private var audioReceiverSocket: DatagramSocket? = null
    private var isAudioReceiverRunning = false
    private var audioReceiverThread: Thread? = null

    // Audio Broadcaster State (Mic or Music stream transmitter)
    private var audioRecord: AudioRecord? = null
    private var isAudioBroadcasting = false
    private var audioBroadcasterThread: Thread? = null

    // Walkie-talkie voice enhancement. Only the mic (voice) path is processed;
    // music/system audio is passed through untouched so songs stay hi-fi.
    private val voiceProcessor = com.syncbuddy.audio.WalkieTalkieNoiseProcessor(
        sampleRate = SAMPLE_RATE,
        frameSize = 512
    )
    @Volatile
    private var voiceNoiseSuppressionEnabled = true
    @Volatile
    private var voiceNoiseSuppressionStrength = 0.75f

    // Live measurement of how much noise the last frame removed, exposed to the UI.
    @Volatile
    private var lastNoiseReductionDb = 0f
    @Volatile
    private var lastVoiceInputRms = 0f
    @Volatile
    private var lastVoiceOutputRms = 0f
    @Volatile
    private var lastVoiceGain = 1f

    // Platform audio effects, held so they are not garbage-collected mid-call.
    private var platformAec: AcousticEchoCanceler? = null
    private var platformNs: NoiseSuppressor? = null

    // Server State
    private var serverSocket: ServerSocket? = null
    private var isServerRunning = false
    private var currentRoomCode = ""
    private var currentHostName = ""
    private var serverExecutor = Executors.newCachedThreadPool()

    // Active Participants: Map of ListenerId -> ParticipantInfo
    data class Participant(
        val id: String,
        val name: String,
        val ip: String,
        val joinedAt: Long,
        var lastSeen: Long
    )
    private val participants = ConcurrentHashMap<String, Participant>()

    // Broadcast audio/music state
    private var isBroadcasting = false
    private var trackTitle = "Offline Stream"
    private var broadcastVolume = 100

    // Unique persistent device identifier for self-filtering
    private val myDeviceId: String by lazy {
        try {
            Settings.Secure.getString(reactContext.contentResolver, Settings.Secure.ANDROID_ID)
                ?: java.util.UUID.randomUUID().toString()
        } catch (e: Exception) {
            java.util.UUID.randomUUID().toString()
        }
    }

    /**
     * Checks if an IP or Device ID belongs to this local phone across all interfaces
     */
    private fun isSelfIpOrDevice(senderIp: String, senderDeviceId: String?): Boolean {
        if (!senderDeviceId.isNullOrEmpty() && senderDeviceId == myDeviceId) {
            return true
        }
        val cleanIp = senderIp.substringBefore('%').trim()
        if (cleanIp.isEmpty() || cleanIp == "127.0.0.1" || cleanIp.equals("localhost", ignoreCase = true)) {
            return true
        }
        val myIp = getLocalIp()
        if (myIp.isNotEmpty() && cleanIp == myIp) {
            return true
        }
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return false
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    val addrIp = (addr.hostAddress ?: "").substringBefore('%').trim()
                    if (addrIp.isNotEmpty() && addrIp == cleanIp) {
                        return true
                    }
                }
            }
        } catch (e: Exception) {}
        return false
    }

    // Power-optimized locks: allows hardware micro-sleeps to prevent phone heating & save battery
    private var multicastLock: WifiManager.MulticastLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var activeLocksCount = 0

    @Synchronized
    private fun acquireMulticastLock() {
        activeLocksCount++
        try {
            if (multicastLock == null || !multicastLock!!.isHeld) {
                val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                multicastLock = wifiManager?.createMulticastLock("SyncBuddyMulticast")
                multicastLock?.setReferenceCounted(false)
                multicastLock?.acquire()
            }
        } catch (e: Exception) {}

        try {
            if (wifiLock == null || !wifiLock!!.isHeld) {
                val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                @Suppress("DEPRECATION")
                val mode = WifiManager.WIFI_MODE_FULL
                wifiLock = wifiManager?.createWifiLock(mode, "SyncBuddyWifiLock")
                wifiLock?.setReferenceCounted(false)
                wifiLock?.acquire()
            }
        } catch (e: Exception) {}

        try {
            if (wakeLock == null || !wakeLock!!.isHeld) {
                val powerManager = reactContext.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SyncBuddy:ScreenOffAudio")
                wakeLock?.setReferenceCounted(false)
                wakeLock?.acquire(60 * 60 * 1000L) // 1 hour timeout
            }
        } catch (e: Exception) {}
    }

    @Synchronized
    private fun releaseMulticastLock() {
        activeLocksCount--
        if (activeLocksCount > 0) return
        activeLocksCount = 0

        try {
            if (multicastLock != null && multicastLock!!.isHeld) {
                multicastLock?.release()
            }
        } catch (e: Exception) {}

        try {
            if (wifiLock != null && wifiLock!!.isHeld) {
                wifiLock?.release()
            }
        } catch (e: Exception) {}

        try {
            if (wakeLock != null && wakeLock!!.isHeld) {
                wakeLock?.release()
            }
        } catch (e: Exception) {}
    }

    @ReactMethod
    fun registerPeerIp(ip: String, promise: Promise) {
        if (ip.isNotEmpty() && !isSelfIpOrDevice(ip, null)) {
            knownPeerIps.add(ip)
        }
        promise.resolve(true)
    }

    // Beacon Sockets
    private var beaconScheduler: ScheduledExecutorService? = null
    private var discoverySocket: DatagramSocket? = null
    private var isDiscoveryRunning = false

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. IP & Network Detection
    // ─────────────────────────────────────────────────────────────────────────

    @ReactMethod
    fun getNetworkInfo(promise: Promise) {
        try {
            val result = Arguments.createMap()
            var detectedIp = ""
            var isWifi = false
            var isHotspot = false
            var ifaceName = ""

            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue

                val name = iface.name.lowercase()
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        val ip = addr.hostAddress ?: ""
                        if (name.contains("wlan")) {
                            detectedIp = ip
                            isWifi = true
                            ifaceName = iface.name
                            break
                        } else if (name.contains("ap") || name.contains("rndis") || name.contains("swlan") || ip.startsWith("192.168.43.")) {
                            detectedIp = ip
                            isHotspot = true
                            ifaceName = iface.name
                            break
                        } else if (detectedIp.isEmpty() && !ip.startsWith("127.")) {
                            detectedIp = ip
                            ifaceName = iface.name
                        }
                    }
                }
                if (detectedIp.isNotEmpty() && (isWifi || isHotspot)) break
            }

            val deviceName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"

            result.putString("ipAddress", detectedIp)
            result.putBoolean("hasNetwork", detectedIp.isNotEmpty())
            result.putBoolean("isWifi", isWifi)
            result.putBoolean("isHotspot", isHotspot)
            result.putString("interfaceName", ifaceName)
            result.putString("deviceName", deviceName)

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_NET_INFO", e.message)
        }
    }

    @ReactMethod
    fun openHotspotSettings(promise: Promise) {
        try {
            val intent = Intent()
            intent.action = "android.settings.TETHER_SETTINGS"
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_WIRELESS_SETTINGS)
                fallback.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                reactApplicationContext.startActivity(fallback)
                promise.resolve(true)
            } catch (e2: Exception) {
                promise.reject("ERR_SETTINGS", e2.message)
            }
        }
    }

    @ReactMethod
    fun openWifiSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_WIFI_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            reactApplicationContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_WIFI_SETTINGS", e.message)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Host Room Server (HTTP Server on Port 8942)
    // ─────────────────────────────────────────────────────────────────────────

    @ReactMethod
    fun startRoomServer(roomCode: String, port: Int, promise: Promise) {
        try {
            if (isServerRunning) {
                val result = Arguments.createMap()
                result.putBoolean("running", true)
                result.putInt("port", port)
                result.putInt("participantsCount", participants.size)
                promise.resolve(result)
                return
            }

            val usePort = if (port > 0) port else DEFAULT_HTTP_PORT
            serverSocket = ServerSocket(usePort)
            serverSocket?.reuseAddress = true
            isServerRunning = true
            currentRoomCode = roomCode
            currentHostName = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
            participants.clear()

            // Run accept loop in background thread
            serverExecutor.execute {
                while (isServerRunning && serverSocket != null && !serverSocket!!.isClosed) {
                    try {
                        val clientSocket = serverSocket!!.accept()
                        serverExecutor.execute {
                            handleClientConnection(clientSocket)
                        }
                    } catch (e: Exception) {
                        if (!isServerRunning) break
                    }
                }
            }

            // Start UDP Beacon for instant LAN discovery
            startBroadcastBeacon(usePort, roomCode)

            val result = Arguments.createMap()
            result.putBoolean("success", true)
            result.putInt("port", usePort)
            result.putString("roomCode", roomCode)
            result.putString("hostName", currentHostName)
            promise.resolve(result)
        } catch (e: Exception) {
            isServerRunning = false
            promise.reject("ERR_START_SERVER", e.message)
        }
    }

    @ReactMethod
    fun stopRoomServer(promise: Promise) {
        try {
            isServerRunning = false
            stopBroadcastBeacon()

            try {
                serverSocket?.close()
            } catch (e: Exception) { }
            serverSocket = null
            participants.clear()
            releaseMulticastLock()

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_SERVER", e.message)
        }
    }

    @ReactMethod
    fun getParticipants(promise: Promise) {
        val list = Arguments.createArray()
        for (p in participants.values) {
            val map = Arguments.createMap()
            map.putString("id", p.id)
            map.putString("name", p.name)
            map.putString("ip", p.ip)
            map.putDouble("joinedAt", p.joinedAt.toDouble())
            map.putDouble("lastSeen", p.lastSeen.toDouble())
            list.pushMap(map)
        }
        promise.resolve(list)
    }

    @ReactMethod
    fun updateBroadcastState(isPlaying: Boolean, title: String, volume: Int, promise: Promise) {
        isBroadcasting = isPlaying
        trackTitle = title
        broadcastVolume = volume

        val event = Arguments.createMap()
        event.putBoolean("isPlaying", isPlaying)
        event.putString("title", title)
        event.putInt("volume", volume)
        sendEvent(EVENT_BROADCAST_STATE, event)

        promise.resolve(true)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal HTTP Connection Handler
    // ─────────────────────────────────────────────────────────────────────────

    private fun handleClientConnection(socket: Socket) {
        var reader: BufferedReader? = null
        var output: OutputStream? = null
        try {
            socket.soTimeout = 8000
            val clientIp = socket.inetAddress.hostAddress ?: "Unknown"
            val cleanClientIp = clientIp.substringBefore('%').trim()
            if (cleanClientIp.isNotEmpty() && cleanClientIp != "Unknown" && !isSelfIpOrDevice(cleanClientIp, null)) {
                knownPeerIps.add(cleanClientIp)
                participantIps.add(cleanClientIp)
            }
            reader = BufferedReader(InputStreamReader(socket.getInputStream()))
            output = socket.getOutputStream()

            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return

            val method = parts[0].uppercase()
            val path = parts[1]

            // Read headers to get content length
            var contentLength = 0
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (line!!.isEmpty()) break
                val lower = line!!.lowercase()
                if (lower.startsWith("content-length:")) {
                    contentLength = lower.substring("content-length:".length).trim().toIntOrNull() ?: 0
                }
            }

            // Read JSON body if POST
            var body = ""
            if (contentLength > 0) {
                val charArray = CharArray(contentLength)
                var readSoFar = 0
                while (readSoFar < contentLength) {
                    val read = reader.read(charArray, readSoFar, contentLength - readSoFar)
                    if (read == -1) break
                    readSoFar += read
                }
                body = String(charArray, 0, readSoFar)
            }

            // Handle CORS preflight
            if (method == "OPTIONS") {
                sendHttpResponse(output, 200, "{\"status\":\"ok\"}")
                return
            }

            when {
                // GET /info -> Basic room info
                method == "GET" && path.startsWith("/info") -> {
                    val json = JSONObject()
                    json.put("status", "ok")
                    json.put("roomCode", currentRoomCode)
                    json.put("hostName", currentHostName)
                    json.put("participantsCount", participants.size + 1) // +1 for host
                    json.put("isBroadcasting", isBroadcasting)
                    json.put("trackTitle", trackTitle)
                    json.put("volume", broadcastVolume)
                    sendHttpResponse(output, 200, json.toString())
                }

                // POST /join -> Listener joins room
                method == "POST" && path.startsWith("/join") -> {
                    val bodyJson = if (body.isNotEmpty()) JSONObject(body) else JSONObject()
                    val reqCode = bodyJson.optString("code", "").trim()

                    // Verify room code if specified
                    if (reqCode.isNotEmpty() && currentRoomCode.isNotEmpty() && !reqCode.equals(currentRoomCode, ignoreCase = true)) {
                        val errResp = JSONObject()
                        errResp.put("success", false)
                        errResp.put("reason", "ROOM_CODE_MISMATCH")
                        errResp.put("message", "Incorrect room code. Check the 4-digit code shown on the host.")
                        sendHttpResponse(output, 200, errResp.toString())
                        return
                    }

                    val listenerId = bodyJson.optString("id", clientIp)
                    val listenerName = bodyJson.optString("name", "Listener ($clientIp)")

                    val now = System.currentTimeMillis()
                    val p = Participant(
                        id = listenerId,
                        name = listenerName,
                        ip = clientIp,
                        joinedAt = now,
                        lastSeen = now
                    )
                    participants[listenerId] = p

                    // Notify React Native JS that a new listener joined!
                    val event = Arguments.createMap()
                    event.putString("id", listenerId)
                    event.putString("name", listenerName)
                    event.putString("ip", clientIp)
                    event.putInt("totalCount", participants.size + 1)
                    event.putDouble("time", now.toDouble())
                    sendEvent(EVENT_LISTENER_JOINED, event)

                    val resp = JSONObject()
                    resp.put("success", true)
                    resp.put("roomCode", currentRoomCode)
                    resp.put("hostName", currentHostName)
                    resp.put("participantsCount", participants.size + 1)
                    resp.put("isBroadcasting", isBroadcasting)
                    resp.put("trackTitle", trackTitle)
                    sendHttpResponse(output, 200, resp.toString())
                }

                // POST /leave -> Listener leaves room
                method == "POST" && path.startsWith("/leave") -> {
                    val bodyJson = if (body.isNotEmpty()) JSONObject(body) else JSONObject()
                    val listenerId = bodyJson.optString("id", clientIp)
                    val removed = participants.remove(listenerId)

                    val event = Arguments.createMap()
                    event.putString("id", listenerId)
                    event.putString("name", removed?.name ?: listenerId)
                    event.putInt("totalCount", participants.size + 1)
                    sendEvent(EVENT_LISTENER_LEFT, event)

                    sendHttpResponse(output, 200, "{\"success\":true}")
                }

                // POST /heartbeat -> Keepalive & fetch sync state
                method == "POST" && path.startsWith("/heartbeat") -> {
                    val bodyJson = if (body.isNotEmpty()) JSONObject(body) else JSONObject()
                    val listenerId = bodyJson.optString("id", clientIp)
                    participants[listenerId]?.lastSeen = System.currentTimeMillis()

                    val resp = JSONObject()
                    resp.put("status", "ok")
                    resp.put("participantsCount", participants.size + 1)
                    resp.put("isBroadcasting", isBroadcasting)
                    resp.put("trackTitle", trackTitle)
                    resp.put("volume", broadcastVolume)
                    sendHttpResponse(output, 200, resp.toString())
                }

                // POST /ptt -> Walkie-Talkie Push-to-Talk message
                method == "POST" && path.startsWith("/ptt") -> {
                    val bodyJson = if (body.isNotEmpty()) JSONObject(body) else JSONObject()
                    val speakerName = bodyJson.optString("speakerName", "Unknown")
                    val isTalking = bodyJson.optBoolean("isTalking", false)

                    val event = Arguments.createMap()
                    event.putString("speakerName", speakerName)
                    event.putBoolean("isTalking", isTalking)
                    sendEvent(EVENT_PTT_MESSAGE, event)

                    // Relay to all participants via UDP broadcast
                    Executors.newSingleThreadExecutor().execute {
                        try {
                            val socket = DatagramSocket()
                            socket.broadcast = true
                            val payload = "SYNCBUDDY_PTT|$speakerName|$isTalking"
                            val data = payload.toByteArray(Charsets.UTF_8)
                            val broadcastAddr = InetAddress.getByName("255.255.255.255")
                            val packet = DatagramPacket(data, data.size, broadcastAddr, DISCOVERY_PORT)
                            socket.send(packet)
                            socket.close()
                        } catch (e: Exception) {}
                    }

                    sendHttpResponse(output, 200, "{\"success\":true}")
                }

                else -> {
                    sendHttpResponse(output, 404, "{\"error\":\"not_found\"}")
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            try { reader?.close() } catch (e: Exception) {}
            try { output?.close() } catch (e: Exception) {}
            try { socket.close() } catch (e: Exception) {}
        }
    }

    private fun sendHttpResponse(output: OutputStream, statusCode: Int, jsonBody: String) {
        val statusText = if (statusCode == 200) "OK" else "Not Found"
        val bytes = jsonBody.toByteArray(Charsets.UTF_8)
        val header = "HTTP/1.1 $statusCode $statusText\r\n" +
                "Content-Type: application/json; charset=UTF-8\r\n" +
                "Content-Length: ${bytes.size}\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                "Access-Control-Allow-Headers: Content-Type, Authorization\r\n" +
                "Connection: close\r\n\r\n"
        output.write(header.toByteArray(Charsets.UTF_8))
        output.write(bytes)
        output.flush()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. UDP Broadcast Beacon & Discovery (Port 8943)
    // ─────────────────────────────────────────────────────────────────────────

    private fun startBroadcastBeacon(httpPort: Int, roomCode: String) {
        stopBroadcastBeacon()
        acquireMulticastLock()
        beaconScheduler = Executors.newSingleThreadScheduledExecutor()
        beaconScheduler?.scheduleAtFixedRate({
            try {
                val socket = DatagramSocket()
                socket.broadcast = true
                val payload = "$BEACON_PREFIX$httpPort|$roomCode|$currentHostName|$myDeviceId"
                val data = payload.toByteArray(Charsets.UTF_8)
                val targets = getBroadcastTargets()
                for (target in targets) {
                    try {
                        val packet = DatagramPacket(data, data.size, target, DISCOVERY_PORT)
                        socket.send(packet)
                    } catch (e: Exception) {}
                }
                socket.close()
            } catch (e: Exception) {
                // Ignore UDP broadcast failure on tethered nets
            }
        }, 500, 2000, TimeUnit.MILLISECONDS)
    }

    private fun stopBroadcastBeacon() {
        try {
            beaconScheduler?.shutdownNow()
        } catch (e: Exception) {}
        beaconScheduler = null
    }

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        try {
            acquireMulticastLock()
            if (isDiscoveryRunning) {
                promise.resolve(true)
                return
            }
            isDiscoveryRunning = true

            Executors.newSingleThreadExecutor().execute {
                try {
                    discoverySocket = DatagramSocket(DISCOVERY_PORT)
                    discoverySocket?.broadcast = true
                    val buffer = ByteArray(1024)

                    while (isDiscoveryRunning && discoverySocket != null && !discoverySocket!!.isClosed) {
                        try {
                            val packet = DatagramPacket(buffer, buffer.size)
                            discoverySocket!!.receive(packet)

                            val message = String(packet.data, 0, packet.length, Charsets.UTF_8)

                            // Handle UDP Walkie-Talkie (PTT) Relay
                            if (message.startsWith("SYNCBUDDY_PTT|")) {
                                val senderIp = packet.address.hostAddress ?: ""
                                val pttParts = message.substring("SYNCBUDDY_PTT|".length).split("|")
                                val senderDeviceId = if (pttParts.size >= 3) pttParts[2] else ""
                                if (isSelfIpOrDevice(senderIp, senderDeviceId)) {
                                    continue
                                }
                                if (senderIp.isNotEmpty() && !knownPeerIps.contains(senderIp)) {
                                    knownPeerIps.add(senderIp)
                                }
                                if (pttParts.size >= 2) {
                                    val speaker = pttParts[0]
                                    val isTalking = pttParts[1].toBoolean()
                                    val event = Arguments.createMap()
                                    event.putString("speakerName", speaker)
                                    event.putBoolean("isTalking", isTalking)
                                    sendEvent(EVENT_PTT_MESSAGE, event)
                                }
                                continue
                            }

                            if (message.startsWith(BEACON_PREFIX)) {
                                val senderIp = packet.address.hostAddress ?: ""
                                val parts = message.substring(BEACON_PREFIX.length).split("|")
                                if (parts.size >= 3) {
                                    val port = parts[0].toIntOrNull() ?: DEFAULT_HTTP_PORT
                                    val roomCode = parts[1]
                                    val hostName = parts[2]
                                    val hostDeviceId = if (parts.size >= 4) parts[3] else ""

                                    // Filter out self beacons so device never sees/joins its own room
                                    if (isSelfIpOrDevice(senderIp, hostDeviceId)) {
                                        continue
                                    }
                                    if (isServerRunning && roomCode == currentRoomCode) {
                                        continue
                                    }

                                    if (senderIp.isNotEmpty() && !knownPeerIps.contains(senderIp)) {
                                        knownPeerIps.add(senderIp)
                                    }

                                    val event = Arguments.createMap()
                                    event.putString("hostIp", senderIp)
                                    event.putInt("port", port)
                                    event.putString("roomCode", roomCode)
                                    event.putString("hostName", hostName)
                                    event.putString("deviceId", hostDeviceId)
                                    sendEvent(EVENT_ROOM_DISCOVERED, event)
                                }
                            }
                        } catch (e: Exception) {
                            if (!isDiscoveryRunning) break
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_DISCOVERY", e.message)
        }
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        try {
            isDiscoveryRunning = false
            discoverySocket?.close()
            discoverySocket = null
            releaseMulticastLock()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_DISCOVERY", e.message)
        }
    }

    /**
     * Broadcast Walkie-Talkie Push-to-Talk message to all devices on the network via UDP
     */
    @ReactMethod
    fun broadcastPtt(speakerName: String, isTalking: Boolean, promise: Promise) {
        Executors.newSingleThreadExecutor().execute {
            try {
                val socket = DatagramSocket()
                socket.broadcast = true
                val payload = "SYNCBUDDY_PTT|$speakerName|$isTalking|$myDeviceId"
                val data = payload.toByteArray(Charsets.UTF_8)
                val targets = getBroadcastTargets()
                for (target in targets) {
                    try {
                        val packet = DatagramPacket(data, data.size, target, DISCOVERY_PORT)
                        socket.send(packet)
                    } catch (e: Exception) {}
                }
                socket.close()
            } catch (e: Exception) {}
        }
        promise.resolve(true)
    }

    private fun getLocalIp(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        val ip = addr.hostAddress ?: ""
                        if (ip.isNotEmpty() && !ip.startsWith("127.")) {
                            return ip
                        }
                    }
                }
            }
        } catch (e: Exception) {}
        return ""
    }

    /**
     * Open Real Camera QR Scanner using Google Play Services Code Scanner
     */
    @ReactMethod
    fun openCameraScanner(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("ERR_ACTIVITY", "Current activity is null")
            return
        }

        try {
            val options = GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()

            val scanner = GmsBarcodeScanning.getClient(activity, options)
            scanner.startScan()
                .addOnSuccessListener { barcode: Barcode ->
                    val raw = barcode.rawValue ?: barcode.displayValue ?: ""
                    promise.resolve(raw)
                }
                .addOnCanceledListener {
                    promise.reject("CANCELLED", "User cancelled scan")
                }
                .addOnFailureListener { e: java.lang.Exception ->
                    promise.reject("ERR_SCAN", e.message)
                }
        } catch (e: Exception) {
            promise.reject("ERR_SCAN_INIT", e.message)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Real Offline Low-Latency Audio Streaming Pipeline (Port 8945)
    // ─────────────────────────────────────────────────────────────────────────

    @ReactMethod
    fun startAudioReceiver(promise: Promise) {
        try {
            acquireMulticastLock()
            if (isAudioReceiverRunning) {
                promise.resolve(true)
                return
            }

            val minBuf = AudioTrack.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            // Buffer capacity ~50-80ms for ultra low latency without underruns
            val bufferCapacity = Math.max(minBuf * 2, 4800 * 2)

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()

            val audioFormat = AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build()

            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(audioAttributes)
                .setAudioFormat(audioFormat)
                .setBufferSizeInBytes(bufferCapacity)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                @Suppress("DEPRECATION")
                audioTrack = AudioTrack(
                    AudioManager.STREAM_MUSIC,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferCapacity,
                    AudioTrack.MODE_STREAM
                )
            }

            try {
                audioTrack?.setVolume(AudioTrack.getMaxVolume())
            } catch (e: Exception) {}

            try { audioReceiverSocket?.close() } catch (e: Exception) {}
            audioReceiverSocket = DatagramSocket(null).apply {
                reuseAddress = true
                receiveBufferSize = 65536
                bind(java.net.InetSocketAddress(AUDIO_STREAM_PORT))
            }
            isAudioReceiverRunning = true

            audioReceiverThread = Thread {
                val buffer = ByteArray(2048)
                var lastPlayedSeq = -1
                var isPrebuffering = true
                var prebufferCount = 0
                val prebufferTarget = 2 // 2 packets = ~20ms cushion before starting playback
                var lastPacketTime = 0L

                while (isAudioReceiverRunning && audioReceiverSocket != null && !audioReceiverSocket!!.isClosed) {
                    try {
                        val packet = DatagramPacket(buffer, buffer.size)
                        audioReceiverSocket!!.receive(packet)

                        val senderIp = packet.address.hostAddress ?: ""
                        if (isSelfIpOrDevice(senderIp, null)) continue

                        if (senderIp.isNotEmpty() && !knownPeerIps.contains(senderIp)) {
                            knownPeerIps.add(senderIp)
                        }

                        val len = packet.length
                        if (len < 8 || audioTrack == null) {
                            // Backward compatibility for legacy 4-byte header
                            if (len > 4 && packet.data[0] == 'S'.code.toByte() &&
                                packet.data[1] == 'B'.code.toByte() &&
                                packet.data[2] == 'U'.code.toByte() &&
                                packet.data[3] == 'D'.code.toByte()
                            ) {
                                if (audioTrack?.playState != AudioTrack.PLAYSTATE_PLAYING) {
                                    try { audioTrack?.play() } catch (e: Exception) {}
                                }
                                audioTrack?.write(packet.data, 4, len - 4)
                            }
                            continue
                        }

                        if (packet.data[0] == 'S'.code.toByte() &&
                            packet.data[1] == 'B'.code.toByte() &&
                            packet.data[2] == 'U'.code.toByte() &&
                            packet.data[3] == 'D'.code.toByte()
                        ) {
                            val seq = ((packet.data[4].toInt() and 0xFF) shl 8) or (packet.data[5].toInt() and 0xFF)
                            val now = System.currentTimeMillis()

                            // If stream was silent for > 350ms, re-anchor prebuffer so playback starts cleanly
                            if (now - lastPacketTime > 350L) {
                                lastPlayedSeq = -1
                                isPrebuffering = true
                                prebufferCount = 0
                            }
                            lastPacketTime = now

                            // Duplicate & stale packet filter
                            if (lastPlayedSeq != -1) {
                                val diff = (seq - lastPlayedSeq) and 0xFFFF
                                if (diff == 0 || diff > 32768) {
                                    // Duplicate or old stale packet -> DROP immediately
                                    continue
                                }
                                if (diff > 1500) {
                                    // Stream reset or track switch
                                    lastPlayedSeq = seq
                                    isPrebuffering = true
                                    prebufferCount = 0
                                } else {
                                    lastPlayedSeq = seq
                                }
                            } else {
                                lastPlayedSeq = seq
                            }

                            val payloadOffset = 8
                            val pcmLen = len - payloadOffset

                            if (isPrebuffering) {
                                try { audioTrack?.write(packet.data, payloadOffset, pcmLen) } catch (e: Exception) {}
                                prebufferCount++
                                if (prebufferCount >= prebufferTarget) {
                                    if (audioTrack?.playState != AudioTrack.PLAYSTATE_PLAYING) {
                                        try { audioTrack?.play() } catch (e: Exception) {}
                                    }
                                    isPrebuffering = false
                                }
                            } else {
                                if (audioTrack?.playState != AudioTrack.PLAYSTATE_PLAYING) {
                                    try { audioTrack?.play() } catch (e: Exception) {}
                                }
                                try {
                                    audioTrack?.write(packet.data, payloadOffset, pcmLen, AudioTrack.WRITE_NON_BLOCKING)
                                } catch (e: Exception) {}
                            }
                        }
                    } catch (e: Exception) {
                        if (!isAudioReceiverRunning) break
                    }
                }
            }
            audioReceiverThread?.start()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_RECV", e.message)
        }
    }

    @ReactMethod
    fun stopAudioReceiver(promise: Promise) {
        try {
            isAudioReceiverRunning = false
            try { audioReceiverSocket?.close() } catch (e: Exception) {}
            audioReceiverSocket = null

            try {
                audioTrack?.stop()
                audioTrack?.release()
            } catch (e: Exception) {}
            audioTrack = null

            releaseMulticastLock()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_RECV", e.message)
        }
    }

    private var isFileBroadcasting = false
    private var isFilePaused = false
    private var fileBroadcasterThread: Thread? = null
    private var activeFileAudioTrack: AudioTrack? = null

    @Volatile private var seekRequestedUs: Long = -1L
    @Volatile private var currentFilePositionSec: Double = 0.0
    @Volatile private var currentFileDurationSec: Double = 0.0

    @Synchronized
    private fun stopAudioFileInternal() {
        isFileBroadcasting = false
        try {
            activeFileAudioTrack?.pause()
            activeFileAudioTrack?.flush()
            activeFileAudioTrack?.stop()
            activeFileAudioTrack?.release()
        } catch (e: Exception) {}
        activeFileAudioTrack = null

        try {
            fileBroadcasterThread?.interrupt()
        } catch (e: Exception) {}
        fileBroadcasterThread = null

        seekRequestedUs = -1L
        currentFilePositionSec = 0.0
        currentFileDurationSec = 0.0

        try {
            com.syncbuddy.media.Media3Manager.stop()
        } catch (e: Exception) {}
    }

    private fun formatFileSize(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val kb = bytes / 1024.0
        val mb = kb / 1024.0
        val gb = mb / 1024.0
        return when {
            gb >= 1.0 -> String.format(Locale.US, "%.1f GB", gb)
            mb >= 1.0 -> String.format(Locale.US, "%.1f MB", mb)
            kb >= 1.0 -> String.format(Locale.US, "%.1f KB", kb)
            else -> "$bytes B"
        }
    }

    @ReactMethod
    fun getDeviceMediaFiles(filter: String, promise: Promise) {
        Executors.newSingleThreadExecutor().execute {
            try {
                val list = Arguments.createArray()
                val resolver = reactApplicationContext.contentResolver
                val seen = HashSet<String>()
                val maxAudio = 2000
                val maxVideo = 1500

                fun extOf(displayName: String?, mime: String?): String {
                    val fromName = (displayName ?: "").substringAfterLast('.', "").trim().uppercase()
                    if (fromName.isNotEmpty() && fromName.length <= 5) return fromName
                    val fromMime = (mime ?: "").substringAfter('/', "").substringBefore(';').trim().uppercase()
                    return fromMime.ifEmpty { "FILE" }
                }

                // 1. Audio — every audio row on the device: music, voice notes,
                //    WhatsApp / SendAnywhere / SnapTube downloads, call recordings.
                //    IS_MUSIC is deliberately NOT filtered: it is 0 for voice notes
                //    and most messaging-app audio, which is exactly why those files
                //    used to be invisible in the player.
                if (filter == "all" || filter == "audio") {
                    val audioUri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                    val projection = arrayOf(
                        MediaStore.Audio.Media._ID,
                        MediaStore.Audio.Media.TITLE,
                        MediaStore.Audio.Media.ARTIST,
                        MediaStore.Audio.Media.ALBUM,
                        MediaStore.Audio.Media.ALBUM_ID,
                        MediaStore.Audio.Media.DURATION,
                        MediaStore.Audio.Media.SIZE,
                        MediaStore.Audio.Media.DATE_ADDED,
                        MediaStore.Audio.Media.MIME_TYPE,
                        MediaStore.Audio.Media.DISPLAY_NAME
                    )
                    try {
                        resolver.query(
                            audioUri,
                            projection,
                            null,
                            null,
                            "${MediaStore.Audio.Media.DATE_ADDED} DESC"
                        )?.use { cursor ->
                            val idCol = cursor.getColumnIndex(MediaStore.Audio.Media._ID)
                            val titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
                            val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                            val albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)
                            val albumIdCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID)
                            val durCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION)
                            val sizeCol = cursor.getColumnIndex(MediaStore.Audio.Media.SIZE)
                            val dateCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED)
                            val mimeCol = cursor.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE)
                            val nameCol = cursor.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)

                            var count = 0
                            while (count < maxAudio && cursor.moveToNext()) {
                                val id = if (idCol >= 0) cursor.getLong(idCol) else 0L
                                val uri = ContentUris.withAppendedId(audioUri, id).toString()
                                if (!seen.add(uri)) continue

                                val displayName = if (nameCol >= 0) cursor.getString(nameCol) else null
                                val mime = if (mimeCol >= 0) cursor.getString(mimeCol) else null
                                val title = (if (titleCol >= 0) cursor.getString(titleCol) else null)
                                    ?.takeIf { it.isNotBlank() }
                                    ?: (displayName ?: "Audio Track")
                                val artist = (if (artistCol >= 0) cursor.getString(artistCol) else null)
                                    ?.takeIf { it.isNotBlank() && it != "<unknown>" }
                                    ?: "Unknown artist"
                                val album = (if (albumCol >= 0) cursor.getString(albumCol) else null) ?: ""
                                val albumId = if (albumIdCol >= 0) cursor.getLong(albumIdCol) else 0L
                                val duration = if (durCol >= 0) cursor.getLong(durCol) else 0L
                                val size = if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L
                                val dateAdded = if (dateCol >= 0) cursor.getLong(dateCol) else 0L
                                val albumArt = if (albumId > 0) {
                                    ContentUris.withAppendedId(
                                        Uri.parse("content://media/external/audio/albumart"),
                                        albumId
                                    ).toString()
                                } else ""

                                val map = Arguments.createMap()
                                map.putString("id", "audio_$id")
                                map.putString("title", title)
                                map.putString("artist", artist)
                                map.putString("album", album)
                                map.putDouble("duration", duration.toDouble())
                                map.putString("uri", uri)
                                map.putString("type", "audio")
                                map.putString("format", extOf(displayName, mime))
                                map.putString("size", formatFileSize(size))
                                map.putDouble("sizeBytes", size.toDouble())
                                map.putDouble("dateAdded", (dateAdded * 1000L).toDouble())
                                map.putString("albumArt", albumArt)
                                map.putString("mimeType", mime ?: "")
                                list.pushMap(map)
                                count++
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                // 2. Video — MP4, MKV, WebM, 3GP, MOV... with a cached poster frame
                //    so the library looks like a real gallery instead of a text list.
                if (filter == "all" || filter == "video") {
                    val videoUri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    val projection = arrayOf(
                        MediaStore.Video.Media._ID,
                        MediaStore.Video.Media.TITLE,
                        MediaStore.Video.Media.DURATION,
                        MediaStore.Video.Media.SIZE,
                        MediaStore.Video.Media.DATE_ADDED,
                        MediaStore.Video.Media.MIME_TYPE,
                        MediaStore.Video.Media.DISPLAY_NAME,
                        MediaStore.Video.Media.BUCKET_DISPLAY_NAME
                    )
                    try {
                        resolver.query(
                            videoUri,
                            projection,
                            null,
                            null,
                            "${MediaStore.Video.Media.DATE_ADDED} DESC"
                        )?.use { cursor ->
                            val idCol = cursor.getColumnIndex(MediaStore.Video.Media._ID)
                            val titleCol = cursor.getColumnIndex(MediaStore.Video.Media.TITLE)
                            val durCol = cursor.getColumnIndex(MediaStore.Video.Media.DURATION)
                            val sizeCol = cursor.getColumnIndex(MediaStore.Video.Media.SIZE)
                            val dateCol = cursor.getColumnIndex(MediaStore.Video.Media.DATE_ADDED)
                            val mimeCol = cursor.getColumnIndex(MediaStore.Video.Media.MIME_TYPE)
                            val nameCol = cursor.getColumnIndex(MediaStore.Video.Media.DISPLAY_NAME)
                            val bucketCol = cursor.getColumnIndex(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)

                            var count = 0
                            var thumbAttempts = 0
                            while (count < maxVideo && cursor.moveToNext()) {
                                val id = if (idCol >= 0) cursor.getLong(idCol) else 0L
                                val uri = ContentUris.withAppendedId(videoUri, id).toString()
                                if (!seen.add(uri)) continue

                                val displayName = if (nameCol >= 0) cursor.getString(nameCol) else null
                                val mime = if (mimeCol >= 0) cursor.getString(mimeCol) else null
                                val title = (if (titleCol >= 0) cursor.getString(titleCol) else null)
                                    ?.takeIf { it.isNotBlank() }
                                    ?: (displayName ?: "Video File")
                                val bucket = (if (bucketCol >= 0) cursor.getString(bucketCol) else null) ?: ""
                                val duration = if (durCol >= 0) cursor.getLong(durCol) else 0L
                                val size = if (sizeCol >= 0) cursor.getLong(sizeCol) else 0L
                                val dateAdded = if (dateCol >= 0) cursor.getLong(dateCol) else 0L

                                // Bounded attempts (not successes) so a library full of
                                // undecodable files cannot stall the first scan.
                                val poster =
                                    if (thumbAttempts < 80) {
                                        thumbAttempts++
                                        buildVideoThumbnail(uri, id)
                                    } else ""

                                val map = Arguments.createMap()
                                map.putString("id", "video_$id")
                                map.putString("title", title)
                                map.putString("artist", "Video")
                                map.putString("album", bucket)
                                map.putDouble("duration", duration.toDouble())
                                map.putString("uri", uri)
                                map.putString("type", "video")
                                map.putString("format", extOf(displayName, mime))
                                map.putString("size", formatFileSize(size))
                                map.putDouble("sizeBytes", size.toDouble())
                                map.putDouble("dateAdded", (dateAdded * 1000L).toDouble())
                                map.putString("albumArt", poster)
                                map.putString("folder", bucket)
                                map.putString("mimeType", mime ?: "")
                                list.pushMap(map)
                                count++
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                promise.resolve(list)
            } catch (e: Exception) {
                promise.reject("ERR_SCAN_MEDIA", e.message)
            }
        }
    }

    /**
     * Cached 256px poster frame for a video, used as the library thumbnail.
     * Returns "" when the platform cannot decode a frame (still playable).
     */
    private fun buildVideoThumbnail(uriString: String, id: Long): String {
        try {
            val ctx = reactApplicationContext
            val dir = java.io.File(ctx.cacheDir, "sb_thumbs")
            if (!dir.exists() && !dir.mkdirs()) return ""
            val file = java.io.File(dir, "v_" + id + ".jpg")
            if (file.exists() && file.length() > 0L) return "file://${file.absolutePath}"

            val uri = Uri.parse(uriString)
            val bitmap: android.graphics.Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ctx.contentResolver.loadThumbnail(uri, android.util.Size(256, 256), null)
            } else {
                val retriever = android.media.MediaMetadataRetriever()
                try {
                    retriever.setDataSource(ctx, uri)
                    retriever.getFrameAtTime(0, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                } finally {
                    try { retriever.release() } catch (e: Exception) {}
                }
            }
            if (bitmap == null) return ""

            java.io.FileOutputStream(file).use { out ->
                bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
            }
            try { bitmap.recycle() } catch (e: Exception) {}
            return "file://${file.absolutePath}"
        } catch (e: Exception) {
            return ""
        }
    }


    @ReactMethod
    fun getDeviceAudioFiles(promise: Promise) {
        getDeviceMediaFiles("audio", promise)
    }

    @ReactMethod
    fun pickAudioFile(promise: Promise) {
        val activity = currentActivity
        if (activity is com.syncbuddy.MainActivity) {
            activity.requestAudioFilePicker(promise)
        } else {
            promise.reject("ERR_ACTIVITY", "MainActivity not available")
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Google Media3 (ExoPlayer) Unified Audio & Video Engine
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Google Media3 (ExoPlayer) + Real-time UDP Room Audio Broadcasting Engine
    // ─────────────────────────────────────────────────────────────────────────

    @ReactMethod
    fun playMediaFile(uriString: String, isVideo: Boolean, broadcastToRoom: Boolean, mimeType: String, promise: Promise) {
        try {
            stopAudioFileInternal()
            stopAudioBroadcasterInternal()
            acquireMulticastLock()

            if (isVideo) {
                // Video surface is driven by Media3; when we also broadcast, ExoPlayer is
                // muted and the UDP decode loop drives the audio so the room stays in
                // lockstep and the same audio never plays twice on the host.
                val exoVolume = if (broadcastToRoom) 0.0f else 1.0f
                com.syncbuddy.media.Media3Manager.play(reactApplicationContext, uriString, true, exoVolume, mimeType)
            } else {
                // Audio always plays locally through Media3 (widest container/codec
                // support); the room stream, when enabled, runs alongside it muted-locally.
                com.syncbuddy.media.Media3Manager.play(reactApplicationContext, uriString, false, 1.0f, mimeType)
            }

            if (broadcastToRoom) {
                startFileBroadcastStreamer(uriString, isVideo, promise)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("ERR_PLAY_MEDIA", e.message)
        }
    }

    private fun startFileBroadcastStreamer(uriString: String, playLocally: Boolean, promise: Promise) {
        try {
            acquireMulticastLock()
            isFileBroadcasting = true
            isFilePaused = false

            fileBroadcasterThread = Thread {
                var extractor: MediaExtractor? = null
                var codec: MediaCodec? = null
                var localTrack: AudioTrack? = null

                try {
                    val context = reactApplicationContext
                    val uri = Uri.parse(uriString)
                    extractor = MediaExtractor()
                    extractor.setDataSource(context, uri, null)

                    var audioTrackIndex = -1
                    var format: MediaFormat? = null
                    for (i in 0 until extractor.trackCount) {
                        val f = extractor.getTrackFormat(i)
                        val mime = f.getString(MediaFormat.KEY_MIME) ?: ""
                        if (mime.startsWith("audio/")) {
                            audioTrackIndex = i
                            format = f
                            break
                        }
                    }

                    if (audioTrackIndex == -1 || format == null) {
                        return@Thread
                    }

                    extractor.selectTrack(audioTrackIndex)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: "audio/mp4a-latm"
                    val fileSampleRate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else SAMPLE_RATE
                    val channelCount = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2

                    codec = MediaCodec.createDecoderByType(mime)
                    codec.configure(format, null, null, 0)
                    codec.start()

                    if (format.containsKey(MediaFormat.KEY_DURATION)) {
                        currentFileDurationSec = format.getLong(MediaFormat.KEY_DURATION) / 1_000_000.0
                    } else {
                        currentFileDurationSec = 0.0
                    }
                    currentFilePositionSec = 0.0

                    // Local monitoring is only needed for video (media3 is muted then).
                    // For audio, Media3 already plays on this phone, so we stream only.
                    if (playLocally) {
                        val minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
                        localTrack = AudioTrack.Builder()
                            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                            .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                            .setBufferSizeInBytes(Math.max(minBuf * 2, 4800 * 2))
                            .setTransferMode(AudioTrack.MODE_STREAM)
                            .build()
                        activeFileAudioTrack = localTrack
                        localTrack?.play()
                    }

                    val packetBuf = ByteArray(968) // 8 byte header + 960 bytes pcm (480 samples = 10ms at 48kHz)
                    packetBuf[0] = 'S'.code.toByte()
                    packetBuf[1] = 'B'.code.toByte()
                    packetBuf[2] = 'U'.code.toByte()
                    packetBuf[3] = 'D'.code.toByte()
                    packetBuf[6] = 1.toByte() // 1 = music/media
                    packetBuf[7] = 2.toByte() // v2

                    DatagramSocket().use { sendSocket ->
                        sendSocket.broadcast = true
                        val info = MediaCodec.BufferInfo()
                        var isEOS = false

                        val chunkSamples = 480 // 10ms at 48kHz
                        val chunkBytes = ByteArray(chunkSamples * 2)
                        var leftoverShorts = ShortArray(0)

                        var streamStartTimeNs = 0L
                        var totalSamplesSent = 0L
                        var seq = 0

                        while (isFileBroadcasting && !isEOS) {
                            if (seekRequestedUs >= 0L) {
                                val targetUs = seekRequestedUs
                                seekRequestedUs = -1L
                                try {
                                    extractor.seekTo(targetUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                                    codec.flush()
                                    leftoverShorts = ShortArray(0)
                                    totalSamplesSent = ((targetUs / 1_000_000.0) * SAMPLE_RATE).toLong()
                                    streamStartTimeNs = System.nanoTime() - ((totalSamplesSent * 1_000_000_000L) / SAMPLE_RATE.toLong())
                                    localTrack?.flush()
                                } catch (e: Exception) {}
                            }

                            while (isFilePaused && isFileBroadcasting) {
                                try { localTrack?.pause() } catch (e: Exception) {}
                                Thread.sleep(30)
                                if (!isFilePaused) {
                                    try { localTrack?.play() } catch (e: Exception) {}
                                    streamStartTimeNs = System.nanoTime() - ((totalSamplesSent * 1_000_000_000L) / SAMPLE_RATE.toLong())
                                }
                            }

                            val inIdx = codec.dequeueInputBuffer(1000)
                            if (inIdx >= 0) {
                                val inBuf = codec.getInputBuffer(inIdx)
                                if (inBuf != null) {
                                    inBuf.clear()
                                    val sampleSize = extractor.readSampleData(inBuf, 0)
                                    if (sampleSize < 0) {
                                        codec.queueInputBuffer(inIdx, 0, 0, 0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                        isEOS = true
                                    } else {
                                        codec.queueInputBuffer(inIdx, 0, sampleSize, extractor.sampleTime, 0)
                                        extractor.advance()
                                    }
                                }
                            }

                            var outIdx = codec.dequeueOutputBuffer(info, 1000)
                            while (outIdx >= 0 && isFileBroadcasting) {
                                val outBuf = codec.getOutputBuffer(outIdx)
                                if (outBuf != null && info.size > 0) {
                                    val outBytes = ByteArray(info.size)
                                    outBuf.position(info.offset)
                                    outBuf.get(outBytes, 0, info.size)

                                    val numRawSamples = info.size / 2
                                    val rawShorts = ShortArray(numRawSamples)
                                    for (i in 0 until numRawSamples) {
                                        val b1 = outBytes[i * 2].toInt() and 0xFF
                                        val b2 = outBytes[i * 2 + 1].toInt()
                                        rawShorts[i] = ((b2 shl 8) or b1).toShort()
                                    }

                                    val monoShorts: ShortArray
                                    if (channelCount >= 2) {
                                        val monoCount = numRawSamples / channelCount
                                        monoShorts = ShortArray(monoCount)
                                        for (i in 0 until monoCount) {
                                            var sum = 0
                                            for (c in 0 until channelCount) {
                                                sum += rawShorts[i * channelCount + c]
                                            }
                                            monoShorts[i] = (sum / channelCount).toShort()
                                        }
                                    } else {
                                        monoShorts = rawShorts
                                    }

                                    val samples48k: ShortArray
                                    if (fileSampleRate != SAMPLE_RATE && fileSampleRate > 0) {
                                        val ratio = SAMPLE_RATE.toDouble() / fileSampleRate.toDouble()
                                        val targetCount = Math.round(monoShorts.size * ratio).toInt()
                                        samples48k = ShortArray(targetCount)
                                        for (i in 0 until targetCount) {
                                            val srcIdx = i / ratio
                                            val idx0 = Math.floor(srcIdx).toInt().coerceIn(0, monoShorts.size - 1)
                                            val idx1 = Math.ceil(srcIdx).toInt().coerceIn(0, monoShorts.size - 1)
                                            val frac = srcIdx - idx0
                                            val s0 = monoShorts[idx0].toDouble()
                                            val s1 = monoShorts[idx1].toDouble()
                                            val interp = s0 + frac * (s1 - s0)
                                            samples48k[i] = Math.round(interp).toInt().coerceIn(-32768, 32767).toShort()
                                        }
                                    } else {
                                        samples48k = monoShorts
                                    }

                                    val combined: ShortArray
                                    if (leftoverShorts.isNotEmpty()) {
                                        combined = ShortArray(leftoverShorts.size + samples48k.size)
                                        System.arraycopy(leftoverShorts, 0, combined, 0, leftoverShorts.size)
                                        System.arraycopy(samples48k, 0, combined, leftoverShorts.size, samples48k.size)
                                    } else {
                                        combined = samples48k
                                    }

                                    var offset = 0
                                    while (offset + chunkSamples <= combined.size && isFileBroadcasting) {
                                        if (streamStartTimeNs == 0L) {
                                            streamStartTimeNs = System.nanoTime()
                                        }

                                        for (i in 0 until chunkSamples) {
                                            val s = combined[offset + i]
                                            chunkBytes[i * 2] = (s.toInt() and 0xFF).toByte()
                                            chunkBytes[i * 2 + 1] = ((s.toInt() shr 8) and 0xFF).toByte()
                                        }

                                        try {
                                            localTrack?.write(chunkBytes, 0, chunkBytes.size, AudioTrack.WRITE_NON_BLOCKING)
                                        } catch (e: Exception) {}

                                        packetBuf[4] = ((seq shr 8) and 0xFF).toByte()
                                        packetBuf[5] = (seq and 0xFF).toByte()
                                        System.arraycopy(chunkBytes, 0, packetBuf, 8, chunkBytes.size)

                                        val targets = getAudioStreamTargets()
                                        for (target in targets) {
                                            try {
                                                val packet = DatagramPacket(packetBuf, 8 + chunkBytes.size, target, AUDIO_STREAM_PORT)
                                                sendSocket.send(packet)
                                            } catch (e: Exception) {}
                                        }

                                        seq = (seq + 1) and 0xFFFF
                                        totalSamplesSent += chunkSamples
                                        offset += chunkSamples
                                        currentFilePositionSec = totalSamplesSent.toDouble() / SAMPLE_RATE.toDouble()

                                        val expectedElapsedNs = (totalSamplesSent * 1_000_000_000L) / SAMPLE_RATE.toLong()
                                        val actualElapsedNs = System.nanoTime() - streamStartTimeNs
                                        val sleepNs = expectedElapsedNs - actualElapsedNs

                                        if (sleepNs > 1_500_000L) {
                                            Thread.sleep(sleepNs / 1_000_000L)
                                        } else if (sleepNs < -40_000_000L) {
                                            streamStartTimeNs = System.nanoTime() - expectedElapsedNs
                                        }
                                    }

                                    val remaining = combined.size - offset
                                    if (remaining > 0) {
                                        leftoverShorts = ShortArray(remaining)
                                        System.arraycopy(combined, offset, leftoverShorts, 0, remaining)
                                    } else {
                                        leftoverShorts = ShortArray(0)
                                    }
                                }
                                codec.releaseOutputBuffer(outIdx, false)
                                outIdx = codec.dequeueOutputBuffer(info, 0)
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    try { codec?.stop(); codec?.release() } catch (e: Exception) {}
                    try { extractor?.release() } catch (e: Exception) {}
                    try { localTrack?.stop(); localTrack?.release() } catch (e: Exception) {}
                    activeFileAudioTrack = null
                    isFileBroadcasting = false
                }
            }
            fileBroadcasterThread?.start()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_FILE_STREAM", e.message)
        }
    }

    @ReactMethod
    fun pauseMediaFile(promise: Promise) {
        try {
            isFilePaused = true
            com.syncbuddy.media.Media3Manager.pause()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_PAUSE_MEDIA", e.message)
        }
    }

    @ReactMethod
    fun resumeMediaFile(promise: Promise) {
        try {
            isFilePaused = false
            com.syncbuddy.media.Media3Manager.resume()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_RESUME_MEDIA", e.message)
        }
    }

    @ReactMethod
    fun stopMediaFile(promise: Promise) {
        try {
            stopAudioFileInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_MEDIA", e.message)
        }
    }

    @ReactMethod
    fun seekMediaFile(positionSeconds: Double, promise: Promise) {
        try {
            seekRequestedUs = (positionSeconds * 1_000_000.0).toLong()
            currentFilePositionSec = positionSeconds
            com.syncbuddy.media.Media3Manager.seekTo(positionSeconds)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SEEK_MEDIA", e.message)
        }
    }

    @ReactMethod
    fun getMediaPlaybackState(promise: Promise) {
        try {
            val map = Arguments.createMap()
            if (isFileBroadcasting) {
                map.putBoolean("isPlaying", isFileBroadcasting && !isFilePaused)
                map.putDouble("position", currentFilePositionSec)
                map.putDouble("duration", currentFileDurationSec)
                map.putBoolean("isVideo", com.syncbuddy.media.Media3Manager.isVideo)
            } else {
                map.putBoolean("isPlaying", com.syncbuddy.media.Media3Manager.isPlaying())
                map.putDouble("position", com.syncbuddy.media.Media3Manager.getPosition())
                map.putDouble("duration", com.syncbuddy.media.Media3Manager.getDuration())
                map.putBoolean("isVideo", com.syncbuddy.media.Media3Manager.isVideo)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_GET_PLAYBACK_STATE", e.message)
        }
    }

    @ReactMethod
    fun launchFullscreenVideo(promise: Promise) {
        try {
            val activity = currentActivity
            if (activity != null) {
                val intent = Intent(activity, com.syncbuddy.media.Media3FullscreenActivity::class.java)
                activity.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.reject("ERR_NO_ACTIVITY", "Current activity not available")
            }
        } catch (e: Exception) {
            promise.reject("ERR_FULLSCREEN", e.message)
        }
    }

    /**
     * Hand a file over to any installed video/audio player. Used for containers
     * Media3 cannot demux (AVI, MPEG-TS, WMV, RM...) so that every file on the
     * device remains playable — in-app when possible, externally otherwise.
     */
    @ReactMethod
    fun openWithExternalPlayer(uriString: String, mimeType: String, promise: Promise) {
        try {
            val ctx: Context = currentActivity ?: reactApplicationContext
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(uriString), if (mimeType.isNotEmpty()) mimeType else "*/*")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val chooser = Intent.createChooser(intent, "Choose an app to play this file")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_EXTERNAL_PLAYER", e.message)
        }
    }

    /**
     * Programmatically force screen orientation between Landscape and Portrait.
     * Overrides system auto-rotate lock so users can rotate videos even when phone
     * auto-rotate is toggled off in Android quick settings.
     */
    @ReactMethod
    fun setScreenOrientation(orientation: String, promise: Promise) {
        try {
            val activity = currentActivity
            if (activity != null) {
                activity.runOnUiThread {
                    try {
                        when (orientation.lowercase()) {
                            "landscape" -> activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                            "portrait" -> activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                            "sensor" -> activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR
                            else -> activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                        }
                        promise.resolve(true)
                    } catch (e: Exception) {
                        promise.reject("ERR_ORIENTATION", e.message)
                    }
                }
            } else {
                promise.reject("ERR_NO_ACTIVITY", "Current activity is null")
            }
        } catch (e: Exception) {
            promise.reject("ERR_ORIENTATION_INIT", e.message)
        }
    }

    // Backward-compatible delegates
    @ReactMethod
    fun playAudioFile(uriString: String, promise: Promise) {
        playMediaFile(uriString, false, true, "", promise)
    }

    @ReactMethod
    fun pauseAudioFile(promise: Promise) {
        pauseMediaFile(promise)
    }

    @ReactMethod
    fun resumeAudioFile(promise: Promise) {
        resumeMediaFile(promise)
    }

    @ReactMethod
    fun seekAudioFile(positionSeconds: Double, promise: Promise) {
        seekMediaFile(positionSeconds, promise)
    }

    @ReactMethod
    fun getAudioPlaybackState(promise: Promise) {
        getMediaPlaybackState(promise)
    }

    @ReactMethod
    fun stopAudioFile(promise: Promise) {
        stopMediaFile(promise)
    }

    @ReactMethod
    fun startAudioBroadcaster(sourceType: String, promise: Promise) {
        try {
            stopAudioBroadcasterInternal()
            acquireMulticastLock()

            if (sourceType.equals("synth", ignoreCase = true)) {
                // Cyber Sync Beat: Synthetic Melodic Groove that plays on Host AND streams to Listeners
                isAudioBroadcasting = true

                val minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
                val localTrack = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(Math.max(minBuf * 2, 4800 * 2))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                localTrack.play()

                audioBroadcasterThread = Thread {
                    val chunkSamples = 480 // 10ms
                    val pcm = ByteArray(chunkSamples * 2)
                    val packetBuf = ByteArray(chunkSamples * 2 + 8)
                    packetBuf[0] = 'S'.code.toByte()
                    packetBuf[1] = 'B'.code.toByte()
                    packetBuf[2] = 'U'.code.toByte()
                    packetBuf[3] = 'D'.code.toByte()
                    packetBuf[6] = 4.toByte() // 4 = synth
                    packetBuf[7] = 2.toByte()

                    val notes = doubleArrayOf(261.63, 329.63, 392.00, 493.88, 523.25, 392.00, 329.63, 261.63)
                    var sampleIdx = 0L
                    var seq = 0
                    var streamStartTimeNs = 0L
                    var totalSamplesSent = 0L

                    try {
                        DatagramSocket().use { sendSocket ->
                            sendSocket.broadcast = true

                            while (isAudioBroadcasting) {
                                if (streamStartTimeNs == 0L) {
                                    streamStartTimeNs = System.nanoTime()
                                }
                                for (i in 0 until chunkSamples) {
                                    val noteIdx = ((sampleIdx / (SAMPLE_RATE / 4)) % notes.size).toInt()
                                    val freq = notes[noteIdx]
                                    val phase = 2.0 * Math.PI * (sampleIdx % SAMPLE_RATE) * freq / SAMPLE_RATE
                                    val melody = Math.sin(phase) * 0.4
                                    val beat = if ((sampleIdx % (SAMPLE_RATE / 2)) < (SAMPLE_RATE / 20)) 0.5 * Math.sin(2.0 * Math.PI * (sampleIdx % 200) * 120.0 / SAMPLE_RATE) else 0.0
                                    val sampleVal = ((melody + beat) * 24000).toInt().coerceIn(-32768, 32767).toShort()

                                    pcm[i * 2] = (sampleVal.toInt() and 0xFF).toByte()
                                    pcm[i * 2 + 1] = ((sampleVal.toInt() shr 8) and 0xFF).toByte()
                                    sampleIdx++
                                }

                                try { localTrack.write(pcm, 0, pcm.size, AudioTrack.WRITE_NON_BLOCKING) } catch (e: Exception) {}

                                packetBuf[4] = ((seq shr 8) and 0xFF).toByte()
                                packetBuf[5] = (seq and 0xFF).toByte()
                                System.arraycopy(pcm, 0, packetBuf, 8, pcm.size)
                                seq = (seq + 1) and 0xFFFF
                                totalSamplesSent += chunkSamples

                                val targets = getAudioStreamTargets()
                                for (target in targets) {
                                    try {
                                        val packet = DatagramPacket(packetBuf, pcm.size + 8, target, AUDIO_STREAM_PORT)
                                        sendSocket.send(packet)
                                    } catch (e: Exception) {}
                                }

                                val expectedElapsedNs = (totalSamplesSent * 1_000_000_000L) / SAMPLE_RATE.toLong()
                                val actualElapsedNs = System.nanoTime() - streamStartTimeNs
                                val sleepNs = expectedElapsedNs - actualElapsedNs

                                if (sleepNs > 1_500_000L) {
                                    Thread.sleep(sleepNs / 1_000_000L)
                                } else if (sleepNs < -40_000_000L) {
                                    streamStartTimeNs = System.nanoTime() - expectedElapsedNs
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        try { localTrack.stop(); localTrack.release() } catch (e: Exception) {}
                    }
                }
                audioBroadcasterThread?.start()
                promise.resolve(true)
            } else if (sourceType.equals("mic", ignoreCase = true)) {
                // Mic mode: record from microphone and broadcast with ultra low latency
                isAudioBroadcasting = true
                val minBuf = AudioRecord.getMinBufferSize(
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                audioRecord = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(minBuf, 480 * 2 * 4)
                )

                // Some vendor ROMs refuse VOICE_COMMUNICATION when another app owns
                // the voice call path, so fall back to the plain MIC source.
                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    try { audioRecord?.release() } catch (e: Exception) {}
                    audioRecord = AudioRecord(
                        MediaRecorder.AudioSource.MIC,
                        SAMPLE_RATE,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        Math.max(minBuf, 480 * 2 * 4)
                    )
                }

                if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                    promise.reject("ERR_MIC", "Microphone not initialized. Check permissions.")
                    return
                }

                // Configure the device's own AEC/NS where the hardware offers it.
                // Our DSP still runs on top (vendors implement these weakly), but this
                // catches speaker echo before it ever reaches our filters.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                    audioRecord?.audioSource == MediaRecorder.AudioSource.VOICE_COMMUNICATION
                ) {
                    val sessionId = audioRecord?.audioSessionId ?: 0
                    if (sessionId != 0) {
                        // Effects must be kept referenced or they are garbage collected.
                        try {
                            platformAec = AcousticEchoCanceler.create(sessionId)?.apply { enabled = true }
                        } catch (e: Exception) { platformAec = null }
                        try {
                            platformNs = NoiseSuppressor.create(sessionId)?.apply { enabled = true }
                        } catch (e: Exception) { platformNs = null }
                        // We run our own AGC: the platform one fights the limiter.
                        try {
                            AutomaticGainControl.create(sessionId)?.enabled = false
                        } catch (e: Exception) {}
                    }
                }

                // Fresh transmission -> clear any state from the previous one.
                try {
                    voiceProcessor.enabled = voiceNoiseSuppressionEnabled
                    voiceProcessor.strength = voiceNoiseSuppressionStrength
                    voiceProcessor.reset()
                } catch (e: Exception) {}

                audioRecord?.startRecording()

                audioBroadcasterThread = Thread {
                    val pcm = ByteArray(960) // 480 samples = 10ms at 48kHz
                    val packetBuf = ByteArray(968)
                    packetBuf[0] = 'S'.code.toByte()
                    packetBuf[1] = 'B'.code.toByte()
                    packetBuf[2] = 'U'.code.toByte()
                    packetBuf[3] = 'D'.code.toByte()
                    packetBuf[6] = 2.toByte() // 2 = mic
                    packetBuf[7] = 2.toByte()
                    var seq = 0

                    try {
                        DatagramSocket().use { sendSocket ->
                            sendSocket.broadcast = true

                            while (isAudioBroadcasting && audioRecord != null) {
                                val read = audioRecord!!.read(pcm, 0, pcm.size)
                                if (read <= 0) {
                                    Thread.sleep(10)
                                    continue
                                }

                                // ── Walkie-talkie noise cancellation ──────────────
                                // Runs on the raw mic PCM before it is packetised, so
                                // the hiss/rumble never reaches the network at all.
                                // Always call this (even when disabled) to keep the
                                // sample count and stream timing consistent.
                                try {
                                    voiceProcessor.enabled = voiceNoiseSuppressionEnabled
                                    voiceProcessor.strength = voiceNoiseSuppressionStrength
                                    voiceProcessor.process(pcm, read)
                                    lastNoiseReductionDb = voiceProcessor.lastSuppressionDb
                                    lastVoiceInputRms = voiceProcessor.inputRms
                                    lastVoiceOutputRms = voiceProcessor.outputRms
                                    lastVoiceGain = voiceProcessor.currentGain
                                } catch (e: Exception) {
                                    // A DSP failure must never break the transmission.
                                    android.util.Log.e("SyncNetwork", "Noise processor error: ${e.message}")
                                }

                                packetBuf[4] = ((seq shr 8) and 0xFF).toByte()
                                packetBuf[5] = (seq and 0xFF).toByte()
                                System.arraycopy(pcm, 0, packetBuf, 8, read)
                                seq = (seq + 1) and 0xFFFF

                                val targets = getAudioStreamTargets()
                                for (target in targets) {
                                    try {
                                        val packet = DatagramPacket(packetBuf, read + 8, target, AUDIO_STREAM_PORT)
                                        sendSocket.send(packet)
                                    } catch (e: Exception) {}
                                }
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
                audioBroadcasterThread?.start()
                promise.resolve(true)
            } else {
                // Music/Lecture/Ambient mode: use System Audio Capture (AudioPlaybackCapture)
                // This captures whatever is playing on the phone (Spotify, YouTube, etc.)
                // and the AudioCaptureService handles the UDP broadcasting
                requestSystemAudioCaptureInternal(promise)
            }
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_BROADCAST", e.message)
        }
    }

    /**
     * Request system audio capture via MediaProjection.
     * Shows the Android consent dialog, then starts AudioCaptureService.
     */
    @ReactMethod
    fun requestSystemAudioCapture(promise: Promise) {
        requestSystemAudioCaptureInternal(promise)
    }

    private fun requestSystemAudioCaptureInternal(promise: Promise) {
        val activity = currentActivity
        if (activity is com.syncbuddy.MainActivity) {
            activity.requestMediaProjection(promise)
        } else {
            promise.reject("ERR_ACTIVITY", "MainActivity not available")
        }
    }

    /**
     * Stop system audio capture service
     */
    @ReactMethod
    fun stopSystemAudioCapture(promise: Promise) {
        try {
            val context = reactApplicationContext
            context.stopService(Intent(context, AudioCaptureService::class.java))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_STOP_CAPTURE", e.message)
        }
    }

    private fun stopAudioBroadcasterInternal() {
        isAudioBroadcasting = false
        isFileBroadcasting = false
        fileBroadcasterThread = null
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {}
        audioRecord = null

        // Release the platform AEC/NS effects and clear DSP state for next time.
        try { platformAec?.enabled = false; platformAec?.release() } catch (e: Exception) {}
        try { platformNs?.enabled = false; platformNs?.release() } catch (e: Exception) {}
        platformAec = null
        platformNs = null
        try { voiceProcessor.reset() } catch (e: Exception) {}
        lastNoiseReductionDb = 0f
        lastVoiceInputRms = 0f
        lastVoiceOutputRms = 0f
        lastVoiceGain = 1f

        // Also stop system audio capture service if running
        try {
            val context = reactApplicationContext
            context.stopService(Intent(context, AudioCaptureService::class.java))
        } catch (e: Exception) {}

        releaseMulticastLock()
    }

    @ReactMethod
    fun stopAudioBroadcaster(promise: Promise) {
        stopAudioBroadcasterInternal()
        promise.resolve(true)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Walkie-Talkie noise cancellation controls
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Enables or disables voice noise cancellation.
     * @param enabled  true = clean the mic signal (default).
     * @param strength 0.0..1.0, how aggressively to remove noise (default 0.75).
     */
    @ReactMethod
    fun setNoiseSuppression(enabled: Boolean, strength: Double, promise: Promise) {
        try {
            voiceNoiseSuppressionEnabled = enabled
            voiceNoiseSuppressionStrength = strength.toFloat().coerceIn(0f, 1f)
            voiceProcessor.enabled = enabled
            voiceProcessor.strength = voiceNoiseSuppressionStrength
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_NS_CONFIG", e.message)
        }
    }

    /** Current noise-suppression configuration. */
    @ReactMethod
    fun getNoiseSuppression(promise: Promise) {
        try {
            val map = Arguments.createMap()
            map.putBoolean("enabled", voiceNoiseSuppressionEnabled)
            map.putDouble("strength", voiceNoiseSuppressionStrength.toDouble())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_NS_READ", e.message)
        }
    }

    /**
     * Live measurements from the voice enhancer, so the walkie-talkie UI can show
     * a real noise-reduction meter instead of a fake animation.
     */
    @ReactMethod
    fun getNoiseSuppressionStats(promise: Promise) {
        try {
            val map = Arguments.createMap()
            map.putBoolean("enabled", voiceNoiseSuppressionEnabled)
            map.putDouble("strength", voiceNoiseSuppressionStrength.toDouble())
            map.putDouble("reductionDb", lastNoiseReductionDb.toDouble())
            map.putDouble("inputLevel", lastVoiceInputRms.toDouble())
            map.putDouble("outputLevel", lastVoiceOutputRms.toDouble())
            map.putDouble("gain", lastVoiceGain.toDouble())
            // 0..1 scale for a UI meter, derived from how much was removed.
            val reduction = (lastNoiseReductionDb / 20.0).coerceIn(0.0, 1.0)
            map.putDouble("reductionRatio", reduction)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERR_NS_STATS", e.message)
        }
    }

    private fun createStatusNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val channel = NotificationChannel(
                    STATUS_NOTIFICATION_CHANNEL_ID,
                    STATUS_NOTIFICATION_NAME,
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "SyncBuddy background running status"
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                }
                val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                manager?.createNotificationChannel(channel)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun showStatusNotificationInternal(title: String, message: String) {
        try {
            createStatusNotificationChannel()
            val context = reactApplicationContext
            val iconRes = context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.sym_def_app_icon

            val launchIntent = Intent(context, com.syncbuddy.MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getActivity(context, 0, launchIntent, flags)

            val notification = NotificationCompat.Builder(context, STATUS_NOTIFICATION_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(iconRes)
                .setOngoing(false) // Swipeable / dismissible by user
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .setOnlyAlertOnce(true)
                .build()

            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(STATUS_NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun dismissStatusNotificationInternal() {
        try {
            val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.cancel(STATUS_NOTIFICATION_ID)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @ReactMethod
    fun showPersistentNotification(title: String, message: String, promise: Promise) {
        try {
            showStatusNotificationInternal(title, message)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIFICATION", e.message)
        }
    }

    @ReactMethod
    fun dismissPersistentNotification(promise: Promise) {
        try {
            dismissStatusNotificationInternal()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_DISMISS_NOTIFICATION", e.message)
        }
    }

    // Required by React Native for event emitters
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    override fun onCatalystInstanceDestroy() {
        dismissStatusNotificationInternal()
        stopAudioBroadcasterInternal()
        stopAudioFileInternal()
        com.syncbuddy.media.Media3Manager.release()
        super.onCatalystInstanceDestroy()
    }
}

