package com.syncbuddy.media

import android.graphics.Color
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/**
 * Media3PlayerViewManager
 *
 * React Native ViewManager that exposes Google Media3's PlayerView to JSX.
 * Renders hardware-accelerated video frames for MP4, MKV, WebM, 3GP, etc.
 */
class Media3PlayerViewManager : SimpleViewManager<PlayerView>() {

    override fun getName(): String = "Media3PlayerView"

    override fun createViewInstance(reactContext: ThemedReactContext): PlayerView {
        val playerView = PlayerView(reactContext).apply {
            setBackgroundColor(Color.BLACK)
            useController = false // Custom React Native controls by default
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            keepScreenOn = true
        }

        Media3Manager.attachPlayerView(playerView)
        return playerView
    }

    override fun onDropViewInstance(view: PlayerView) {
        Media3Manager.detachPlayerView(view)
        super.onDropViewInstance(view)
    }

    @ReactProp(name = "uri")
    fun setUri(view: PlayerView, uri: String?) {
        if (!uri.isNullOrEmpty() && uri != Media3Manager.currentUri) {
            Media3Manager.play(view.context, uri, isVideoFile = true)
        }
    }

    @ReactProp(name = "isPlaying")
    fun setIsPlaying(view: PlayerView, isPlaying: Boolean) {
        if (isPlaying) {
            Media3Manager.resume()
        } else {
            Media3Manager.pause()
        }
    }

    @ReactProp(name = "resizeMode")
    fun setResizeMode(view: PlayerView, mode: String?) {
        view.resizeMode = when (mode?.lowercase()) {
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            "zoom" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            "fixed_width" -> AspectRatioFrameLayout.RESIZE_MODE_FIXED_WIDTH
            "fixed_height" -> AspectRatioFrameLayout.RESIZE_MODE_FIXED_HEIGHT
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    @ReactProp(name = "useController", defaultBoolean = false)
    fun setUseController(view: PlayerView, use: Boolean) {
        view.useController = use
    }
}

