package com.syncbuddy.media

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.PresetReverb
import android.media.audiofx.Virtualizer
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlin.math.roundToInt

/**
 * Media3FullscreenActivity
 *
 * Immersive, edge-to-edge fullscreen video player (VLC / MX Player style).
 *
 * This used to be a bare PlayerView with a single close button. It now carries
 * the same capabilities as the React web player so the two platforms behave
 * consistently:
 *
 *   • tap-to-toggle chrome that auto-hides during playback
 *   • brightness with real screen backlight control, plus a dim overlay so the
 *     range below the OS minimum actually works
 *   • volume slider bound to the music stream
 *   • equaliser, bass boost, virtualiser and reverb via Android AudioFx
 *
 * AudioFx note: every effect MUST be kept in a field. If the only reference is
 * local, the garbage collector releases it and the effect silently stops
 * working — a classic and very hard-to-debug AudioFx trap.
 */
class Media3FullscreenActivity : Activity() {

    private var playerView: PlayerView? = null
    private var dimOverlay: View? = null
    private var chrome: LinearLayout? = null
    private var panel: LinearLayout? = null
    private var panelKind: String = ""
    private var playLabel: TextView? = null

    private var brightnessValue = 1.0f
    private var previousBrightness = -1f
    private var currentEqPreset = "flat"
    private var currentFxPreset = "off"

    // Hold strong references so AudioFx objects are not garbage collected.
    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var virtualizer: Virtualizer? = null
    private var reverb: PresetReverb? = null

    private companion object {
        const val PANEL_NONE = ""
        const val PANEL_DISPLAY = "display"
        const val PANEL_SOUND = "sound"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            setBackgroundColor(Color.BLACK)
            useController = false          // this activity provides its own chrome
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            player = Media3Manager.getPlayer(this@Media3FullscreenActivity)
            setOnClickListener { toggleChrome() }
        }
        root.addView(
            playerView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        // Dim overlay: lets brightness go below the OS minimum, which hardware
        // backlight control alone cannot reach. Never intercepts touches.
        dimOverlay = View(this).apply {
            setBackgroundColor(Color.BLACK)
            alpha = 0f
            isClickable = false
            isFocusable = false
        }
        root.addView(
            dimOverlay,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        root.addView(
            buildChrome(),
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)

        applyAudioEffects(currentEqPreset, currentFxPreset)
    }

    // ── Chrome ───────────────────────────────────────────────────────────────

    private fun buildChrome(): LinearLayout {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Transparent root: the scrims are applied to the top and bottom rows
            // only. A background here would dim the whole video, not just the bars.
            setBackgroundColor(Color.TRANSPARENT)
            visibility = View.VISIBLE
            // Tapping empty chrome area (the video) dismisses the controls. Child
            // buttons consume their own clicks, so this only fires on dead space.
            isClickable = true
            setOnClickListener { toggleChrome() }
        }

        // Spacer keeps the top row at the top and the controls at the bottom.
        bar.addView(
            View(this),
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        )

        // Top row: close, title, display, sound.
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#99000000"))
            setPadding(40, 40, 40, 20)
        }

        top.addView(iconButton(android.R.drawable.ic_menu_close_clear_cancel) { finish() })

        val title = TextView(this).apply {
            val uri = Media3Manager.currentUri ?: ""
            text = uri.substringAfterLast('/').ifEmpty { "Now playing" }
            setTextColor(Color.WHITE)
            textSize = 15f
            setPadding(28, 0, 28, 0)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        top.addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        top.addView(iconButton(android.R.drawable.ic_menu_camera) { togglePanel(PANEL_DISPLAY) })
        top.addView(iconButton(android.R.drawable.ic_menu_sort_by_size) { togglePanel(PANEL_SOUND) })
        bar.addView(top)

        // Slide-up panel container.
        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#E60A0A0E"))
            setPadding(48, 36, 48, 36)
            visibility = View.GONE
        }
        bar.addView(panel)

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#99000000"))
            setPadding(40, 24, 40, 48)
        }
        controls.addView(controlButton("<<") { seekBy(-10_000) })
        playLabel = controlButton(if (Media3Manager.isPlaying()) "II" else ">") { togglePlay() }
        controls.addView(playLabel)
        controls.addView(controlButton(">>") { seekBy(10_000) })
        bar.addView(controls)

        chrome = bar
        bar.postDelayed({ if (Media3Manager.isPlaying()) hideChrome() }, 3200)
        return bar
    }

    private fun iconButton(icon: Int, onClick: () -> Unit): ImageButton =
        ImageButton(this).apply {
            setImageResource(icon)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            setPadding(20, 20, 20, 20)
            setOnClickListener {
                it.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
                showChrome()
            }
        }

    private fun controlButton(label: String, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 18f
            gravity = Gravity.CENTER
            setPadding(48, 24, 48, 24)
            setOnClickListener {
                onClick()
                showChrome()
            }
        }

    private fun togglePlay() {
        if (Media3Manager.isPlaying()) Media3Manager.pause() else Media3Manager.resume()
        playLabel?.text = if (Media3Manager.isPlaying()) "II" else ">"
    }

    private fun seekBy(deltaMs: Long) {
        val pos = (Media3Manager.getPosition() * 1000).toLong() + deltaMs
        Media3Manager.seekTo((if (pos < 0) 0 else pos) / 1000.0)
    }

    private fun toggleChrome() {
        if (panel?.visibility == View.VISIBLE) {
            hidePanel()
            return
        }
        if (chrome?.visibility == View.VISIBLE) hideChrome() else showChrome()
    }

    private fun showChrome() {
        chrome?.visibility = View.VISIBLE
        chrome?.postDelayed({
            if (Media3Manager.isPlaying() && panel?.visibility != View.VISIBLE) hideChrome()
        }, 3200)
    }

    private fun hideChrome() {
        if (panel?.visibility == View.VISIBLE) return
        chrome?.visibility = View.GONE
    }

    // ── Panels ───────────────────────────────────────────────────────────────

    private fun togglePanel(kind: String) {
        if (panelKind == kind) {
            hidePanel()
            return
        }
        panelKind = kind
        panel?.removeAllViews()
        panel?.visibility = View.VISIBLE
        if (kind == PANEL_DISPLAY) buildDisplayPanel() else buildSoundPanel()
    }

    private fun hidePanel() {
        panelKind = PANEL_NONE
        panel?.visibility = View.GONE
        panel?.removeAllViews()
    }

    private fun panelTitle(text: String): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(Color.parseColor("#22D3EE"))
            textSize = 12f
            setPadding(0, 24, 0, 16)
        }

    private fun buildDisplayPanel() {
        val p = panel ?: return
        p.removeAllViews()
        p.addView(panelTitle("BRIGHTNESS  ${(brightnessValue * 100).roundToInt()}%"))

        val bar = SeekBar(this).apply {
            max = 100
            progress = ((brightnessValue - 0.2f) / 1.2f * 100).roundToInt().coerceIn(0, 100)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) setBrightness(0.2f + progress / 100f * 1.2f)
                }
                override fun onStartTrackingTouch(sb: SeekBar?) {}
                override fun onStopTrackingTouch(sb: SeekBar?) {}
            })
        }
        p.addView(bar)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 20, 0, 0)
        }
        listOf("Dim" to 0.45f, "Soft" to 0.75f, "Normal" to 1.0f, "Bright" to 1.3f)
            .forEach { (label, v) ->
                row.addView(
                    pill(label, kotlin.math.abs(brightnessValue - v) < 0.12f) {
                        setBrightness(v)
                        buildDisplayPanel()
                    },
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                )
            }
        p.addView(row)
    }

    private fun buildSoundPanel() {
        val p = panel ?: return
        p.removeAllViews()
        val am = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        p.addView(panelTitle("VOLUME"))

        val volBar = SeekBar(this).apply {
            max = am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
            progress = am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                    if (fromUser) {
                        am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, progress, 0)
                    }
                }
                override fun onStartTrackingTouch(sb: SeekBar?) {}
                override fun onStopTrackingTouch(sb: SeekBar?) {}
            })
        }
        p.addView(volBar)

        p.addView(panelTitle("EQUALISER"))
        val eqRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(
            "flat" to "Flat", "bass" to "Bass", "vocal" to "Vocal",
            "cinema" to "Cinema", "night" to "Night"
        ).forEach { (key, label) ->
            eqRow.addView(
                pill(label, currentEqPreset == key) {
                    currentEqPreset = key
                    applyAudioEffects(key, currentFxPreset)
                    buildSoundPanel()
                },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            )
        }
        p.addView(eqRow)

        p.addView(panelTitle("SOUND EFFECTS"))
        val fxRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("off" to "Off", "room" to "Room", "hall" to "Hall", "echo" to "Echo")
            .forEach { (key, label) ->
                fxRow.addView(
                    pill(label, currentFxPreset == key) {
                        currentFxPreset = key
                        applyAudioEffects(currentEqPreset, key)
                        buildSoundPanel()
                    },
                    LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                )
            }
        p.addView(fxRow)
    }

    private fun pill(label: String, active: Boolean = false, onClick: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            setTextColor(Color.parseColor(if (active) "#22D3EE" else "#A1A1AA"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(12, 18, 12, 18)
            setBackgroundColor(Color.parseColor(if (active) "#1A22D3EE" else "#17171F"))
            setOnClickListener {
                onClick()
                showChrome()
            }
        }

    // ── Brightness ───────────────────────────────────────────────────────────

    /**
     * Sets on-screen brightness.
     *
     * Hardware backlight can only go down to the system minimum, so dark values
     * also raise a black overlay. That makes "Dim" genuinely darker instead of
     * silently bottoming out at the OS floor.
     */
    private fun setBrightness(value: Float) {
        val v = value.coerceIn(0.2f, 1.4f)
        brightnessValue = v
        if (previousBrightness < 0f) {
            previousBrightness = window.attributes.screenBrightness
        }
        val attrs = window.attributes
        attrs.screenBrightness = v.coerceIn(0.02f, 1f)
        window.attributes = attrs

        val overlayAlpha = if (v < 0.5f) ((0.5f - v) / 0.5f) * 0.55f else 0f
        dimOverlay?.alpha = overlayAlpha.coerceIn(0f, 0.6f)
    }

    // ── Audio effects ────────────────────────────────────────────────────────

    private fun audioSessionId(): Int =
        try {
            val player = playerView?.player ?: Media3Manager.getPlayer(this)
            player.audioSessionId
        } catch (e: Exception) {
            0
        }

    /**
     * Applies the equaliser and effects to the player's audio session.
     *
     * ExoPlayer only allocates its audio session once the audio renderer is
     * initialised, so a session id of 0 means "not ready yet". Rather than
     * silently doing nothing (which looks like broken controls), retry a few
     * times on the UI thread until the session exists.
     */
    private fun applyAudioEffects(eqPreset: String, fxPreset: String, attempt: Int = 0) {
        val session = audioSessionId()
        if (session == 0) {
            if (attempt < 8) {
                playerView?.postDelayed({
                    applyAudioEffects(eqPreset, fxPreset, attempt + 1)
                }, 250L)
            }
            return
        }

        try {
            releaseEffects()

            val presets = mapOf(
                "flat" to floatArrayOf(),
                "bass" to floatArrayOf(7f, 5f, 1f, 0f, -1f, -2f),
                "vocal" to floatArrayOf(-3f, -1f, 2f, 5f, 4f, 1f),
                "cinema" to floatArrayOf(5f, 2f, -2f, 1f, 4f, 5f),
                "night" to floatArrayOf(-6f, -3f, 1f, 4f, 3f, -4f)
            )
            val gains = presets[eqPreset]

            val eq = Equalizer(0, session)
            if (gains != null && gains.isNotEmpty()) {
                eq.enabled = true
                val levelRange = eq.bandLevelRange        // millibels
                val lo = levelRange[0].toInt()
                val hi = levelRange[1].toInt()
                val bandCount = eq.numberOfBands.toInt()
                for (i in 0 until bandCount) {
                    val gDb = if (i < gains.size) gains[i] else 0f
                    val mb = (gDb * 100).roundToInt().coerceIn(lo, hi)
                    eq.setBandLevel(i.toShort(), mb.toShort())
                }
                equalizer = eq

                // Reinforce the bass-heavy presets audibly.
                if (eqPreset == "bass" || eqPreset == "cinema") {
                    bassBoost = BassBoost(0, session).apply {
                        setStrength(800.toShort())
                        enabled = true
                    }
                    virtualizer = Virtualizer(0, session).apply {
                        setStrength(600.toShort())
                        enabled = true
                    }
                }
            } else {
                // Flat: leave the equaliser disabled.
                eq.enabled = false
                equalizer = eq
            }

            val reverbPreset = when (fxPreset) {
                "room" -> PresetReverb.PRESET_SMALLROOM
                "hall" -> PresetReverb.PRESET_LARGEROOM
                "stadium" -> PresetReverb.PRESET_MEDIUMHALL
                "echo" -> PresetReverb.PRESET_PLATE
                else -> PresetReverb.PRESET_NONE
            }
            reverb = PresetReverb(0, session).apply {
                preset = reverbPreset
                enabled = reverbPreset != PresetReverb.PRESET_NONE
            }
        } catch (e: Exception) {
            // AudioFx is unavailable on some emulators and refuses a second
            // instance per session. Never let it crash playback.
            android.util.Log.w("Media3Fullscreen", "Audio effects unavailable: ${e.message}")
        }
    }

    private fun releaseEffects() {
        try { equalizer?.release() } catch (_: Exception) {}
        try { bassBoost?.release() } catch (_: Exception) {}
        try { virtualizer?.release() } catch (_: Exception) {}
        try { reverb?.release() } catch (_: Exception) {}
        equalizer = null
        bassBoost = null
        virtualizer = null
        reverb = null
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { c ->
                c.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                c.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
    }

    override fun onDestroy() {
        // Restore the user's own brightness when leaving the player.
        if (previousBrightness >= 0f) {
            try {
                val attrs = window.attributes
                attrs.screenBrightness = previousBrightness
                window.attributes = attrs
            } catch (_: Exception) {}
        }
        releaseEffects()
        playerView?.player = null
        super.onDestroy()
    }
}
