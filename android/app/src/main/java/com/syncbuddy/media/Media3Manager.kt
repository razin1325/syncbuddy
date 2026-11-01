package com.syncbuddy.media

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * Media3Manager
 *
 * Singleton managing a single high-performance Google Media3 ExoPlayer instance.
 * Guarantees that only ONE audio/video file plays at any given time, eliminating
 * duplicate/overlapping audio playback.
 */
object Media3Manager {
    private var exoPlayer: ExoPlayer? = null
    private var attachedPlayerView: PlayerView? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile var currentUri: String? = null
    @Volatile var isVideo: Boolean = false

    fun getPlayer(context: Context): ExoPlayer {
        if (exoPlayer == null) {
            val audioAttrs = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build()

            exoPlayer = ExoPlayer.Builder(context.applicationContext)
                .setAudioAttributes(audioAttrs, true)
                .build().apply {
                    repeatMode = Player.REPEAT_MODE_OFF
                }
        }
        return exoPlayer!!
    }

    fun play(context: Context, uriString: String, isVideoFile: Boolean) {
        mainHandler.post {
            try {
                val player = getPlayer(context)
                currentUri = uriString
                isVideo = isVideoFile

                val uri = Uri.parse(uriString)
                val mediaItem = MediaItem.fromUri(uri)

                player.stop()
                player.clearMediaItems()
                player.setMediaItem(mediaItem)
                player.prepare()
                player.play()

                // Re-bind to attached view if one exists
                attachedPlayerView?.player = player
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun pause() {
        mainHandler.post {
            try {
                exoPlayer?.pause()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun resume() {
        mainHandler.post {
            try {
                exoPlayer?.play()
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun stop() {
        mainHandler.post {
            try {
                exoPlayer?.stop()
                exoPlayer?.clearMediaItems()
                currentUri = null
                isVideo = false
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun seekTo(positionSec: Double) {
        mainHandler.post {
            try {
                val ms = (positionSec * 1000).toLong()
                exoPlayer?.seekTo(ms)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun getPosition(): Double {
        val player = exoPlayer ?: return 0.0
        val pos = player.currentPosition
        return if (pos > 0) pos / 1000.0 else 0.0
    }

    fun getDuration(): Double {
        val player = exoPlayer ?: return 0.0
        val dur = player.duration
        return if (dur > 0 && dur != C.TIME_UNSET) dur / 1000.0 else 0.0
    }

    fun isPlaying(): Boolean {
        return exoPlayer?.isPlaying ?: false
    }

    fun attachPlayerView(view: PlayerView) {
        mainHandler.post {
            try {
                attachedPlayerView = view
                exoPlayer?.let { player ->
                    view.player = player
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun detachPlayerView(view: PlayerView) {
        mainHandler.post {
            try {
                if (attachedPlayerView == view) {
                    view.player = null
                    attachedPlayerView = null
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun release() {
        mainHandler.post {
            try {
                exoPlayer?.release()
                exoPlayer = null
                attachedPlayerView = null
                currentUri = null
                isVideo = false
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}

