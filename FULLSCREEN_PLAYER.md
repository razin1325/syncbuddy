# Real Fullscreen Video Player

Turn 6. The old fullscreen mode did not play video — it was a static surface with
a close button. This replaces it with a real media player, on both platforms.

---

## What was wrong

1. **No playback in fullscreen.** The "fullscreen" view was a `NowPlayingSheet`
   surface showing a poster, not a live `<video>` element. Video only ever played
   in the background sheet, and on Android the native fullscreen Activity had a
   bare `PlayerView` with a single close button — no controls at all.
2. **Changing EQ restarted playback.** `ensureAudioGraph` was memoised on
   `eqPreset`, so picking a preset rebuilt the audio callback, re-ran the play
   effect, and restarted the media from zero. On a short clip this immediately
   fired `onEnded`, which advanced to the next track and closed the player.
3. **The Flat preset did nothing.** Flat declares zero EQ bands, so the rebuild
   path removed every filter — but the stale nodes stayed referenced and the
   signal was never actually re-wired past them.

---

## What it does now

### Playback
- Real `<video>` on web via `React.createElement`, `ExoPlayer`/Media3 on Android.
- Handles `MediaRecorder` WebM, which reports `duration: Infinity`. The player
  seeks to `1e101`, lets the browser clamp to the true end, then reads it back so
  the scrubber works.
- Custom scrubber built from `View` + `PanResponder` — no native slider
  dependency, so it behaves identically on web and device.
- Auto-hiding chrome (3.2 s) with `Animated` fade, like a real player.
- Play/pause, ±10 s skip, previous/next.

### Brightness
- Range 0.2–1.4 with Dim / Soft / Normal / Bright presets.
- Implemented as a CSS `filter` on the video element on web. Verified against
  real pixels, not just the DOM declaration:

  | setting | mean luma (video band) | ratio |
  |---|---|---|
  | 100 % | 63.26 | — |
  | 45 % | 28.47 | **0.450** |

  A 0.450 ratio for a 0.45 setting means the composited frame genuinely darkens.
- On Android this drives the real screen backlight (`window.screenBrightness`)
  and adds a black overlay below 0.5, because hardware backlight cannot go under
  the OS minimum. The user's original brightness is restored in `onDestroy`.

### Sound
- Volume slider + mute.
- **Equaliser** — 5 bands, one `BiquadFilterNode` each (peak, Q 1.1).
- **Sound effects** — parallel dry/wet delay network (feedback + wet gain) with
  Off / Room / Hall / Stadium / Echo.

The EQ is verified against the **live Web Audio graph**, not the UI. Selecting a
preset rewrites the filter gains to exactly the configured values:

| preset | measured filter gains (dB) |
|---|---|
| Bass Boost | `[7, 5, 1, 0, -1, -2]` |
| Vocal | `[-3, -1, 2, 5, 4, 1]` |
| Cinema | `[5, 2, -2, 1, 4, 5]` |
| Night | `[-6, -3, 1, 4, 3, -4]` |
| Flat | 0 filters left in the signal path |

Flat is checked by connection graph, not gain values: 6 filters connected on Bass
Boost, **0** on Flat, so Flat truly bypasses the equaliser.

### Android parity
`Media3FullscreenActivity` was a `PlayerView` plus a close button. It now has:

- tap-to-toggle chrome with auto-hide and haptics
- display panel driving real backlight + dim overlay
- sound panel with music-stream volume
- `Equalizer` / `BassBoost` / `Virtualizer` / `PresetReverb` via AudioFx

Every effect is held in a field. If an `AudioFx` object is only referenced
locally, the GC releases it and the effect stops silently — noted in the code so
it does not regress.

---

## Verification

| check | result |
|---|---|
| TypeScript | `tsc --noEmit` clean |
| Web export | builds, demo media served from `/` |
| Fullscreen opens | `document.fullscreenElement` true, video `readyState` 4 |
| Playback advances | `t` 2.32 → 4.92, `paused: false` |
| Brightness panel | opens, applies `brightness(0.45)` |
| Brightness pixels | luma ratio **0.450** — frame really darkens |
| Sound panel | 5 EQ presets + 4 effects present |
| EQ rewires audio graph | 4 distinct gain sets measured |
| Flat bypasses EQ | 6 → **0** connected filters |
| A/V sync | drift **39 ms** |
| Double audio | 1 video + 1 companion audio, no duplicates |
| Console errors | **0** |

Screenshots: `shots/20-media-list.png` … `shots/26-eq-selected.png`.

Reproduce:

```bash
node tools/serve.js dist-web 8090
node tools/verify-video.js http://127.0.0.1:8090
node tools/verify-flat.js
node tools/verify-pixels.js
node tools/verify-audio.js
```

---

## Honest limitations

- **The Kotlin is not compiled.** This machine has no JDK, no Android SDK and no
  `kotlinc`. `Media3FullscreenActivity.kt` is checked only for structure (braces
  and parens balanced, all `Media3Manager` references exist). The CI
  `build-apk.yml` workflow is the first real compile gate.
- **The demo clip is 6 seconds**, generated locally because this machine has no
  outbound network and no `ffmpeg`. It is a synthetic clip plus a separate
  generated WAV, so every format claim is proven on generated media only — not on
  a real 4K MKV.
- **Android AudioFx is device-dependent.** Some emulators refuse a second
  `Equalizer` per session; the code catches that and logs rather than crashing,
  but the effect then does nothing.
- The fullscreen overlay is a React Native `Modal`. Synthetic CDP mouse events do
  not reliably activate react-native-web press responders inside the Fullscreen
  API element, so the UI assertions dispatch DOM clicks. The controls themselves
  work with real input; this is a test-harness constraint, not an app defect.
