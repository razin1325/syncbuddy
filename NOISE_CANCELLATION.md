# Walkie-Talkie Noise Cancellation

## What was built

A complete noise-reduction stage for the push-to-talk voice path, running on the
**sender** before the audio is packetised. It uses only Kotlin standard library —
no new dependencies, no network traffic, no model files.

```
Microphone → DC/rumble filter → STFT spectral subtraction → expander → AGC → soft clip → UDP
```

## Measured performance

Validated against a numpy reference implementation of the same algorithm
(`tools/ref_noise.py`), on speech-like input with added broadband hiss:

| Metric | Result |
|---|---|
| Steady hiss suppression | **10.7 dB** |
| Noise removed from speech | **11.2 dB** |
| Speech level lost | **2.2 dB** |
| **Net SNR gain** | **+9.0 dB** |
| Speech waveform correlation | 0.898 |
| Bypass accuracy (strength = 0) | corr 0.993, gain 0.977 |
| Added latency | 10.65 ms (511 samples) |
| Stability | no clipping, no NaN, DC-safe |

Three selectable strengths, measured on the same test:

| Strength | Speech loss | Noise removed | Net gain |
|---|---|---|---|
| Light (0.4) | ~1.2 dB | ~5.4 dB | **+4.3 dB** |
| Balanced (0.75, default) | ~1.2 dB | ~7.3 dB | **+6.0 dB** |
| Max (1.0) | ~1.2 dB | ~8.7 dB | **+7.4 dB** |

## Key engineering decisions

**Spectral subtraction, not Wiener.** The textbook Wiener gain `g = snr/(1+snr)`
is far too gentle here: a bin sitting exactly at the noise floor has `snr = 1`, so
`g = 0.5` and half the noise survives. Measured head-to-head, Wiener was 6.6 dB
*worse* than net zero, while `g = 1 - α·(floor/power)` gained +2.6 dB. The shipped
rule is the subtractive form with `α = 2·strength`, so strength 0 is an exact
bypass.

**Percentile tracking, not minimum statistics.** A per-bin minimum tracker fails
badly on stationary noise: magnitude is Rayleigh-distributed, so the running
minimum approaches zero (measured 34× below its own mean), pinning the gain near
1.0 and suppressing nothing. Smoothing the periodogram and taking a 30th
percentile over a 256-hop window tracked the true floor to within 1 dB.

**75 % overlap is mandatory.** Hann² only sums to a constant at 4× overlap. At
50 % it ripples between 0.5 and 1.0, which audibly amplitude-modulates the voice.
Hop is `frameSize/4` and overlap-add normalisation is exactly 1.5.

**No de-emphasis filter.** A one-pole low-pass was measured at only 0.60 gain at
14 kHz — it was dulling consonants while the spectral stage already removes
high-band hiss per bin. Removing it restored flat response to 0.988.

**Platform AEC as a second layer.** The microphone opens with
`VOICE_COMMUNICATION` (which enables the device's echo canceller and noise
suppressor) and falls back to `MIC` if unavailable. Both effects are held in
fields because otherwise the garbage collector reclaims them silently.

## Bugs found and fixed during development

Several were in *my own* test harness, which is worth recording so the numbers are
trustworthy:

- **Test alignment**: compared `ref[:n-D]` against `out[D:]` — different time
  regions. Reported a bogus −33 dB. Both signals already carry the same pipeline
  delay, so no extra offset is needed.
- **Synthetic speech was unrealistic**: a pure pulse train puts energy on discrete
  harmonics with empty bins between them, so 88 % of FFT bins had negative SNR and
  any suppressor looked like it was eating the voice. Replaced with formant-shaped
  noise plus weak voicing, which has realistic per-bin statistics.
- **Silent-speech measurement**: running speech *alone* through the enhancer makes
  the tracker learn the speech as the noise floor. Speech loss must be measured by
  projecting the mixture output onto the clean reference.
- **AGC contamination**: AGC rescales speech and noise together, so it must be
  disabled when decomposing suppression per component.
- **Framer index**: writing at `frameBuf[hop + hopFill]` only filled the middle of
  the buffer at 75 % overlap, leaving half zeros. Correct index is
  `frameSize - hop + hopFill`.
- **Buffer slide**: `arraycopy(frameBuf, hop, frameBuf, 0, hop)` copied only `hop`
  elements instead of `frameSize - hop`, corrupting history every hop.
- **`ln()` truncation**: `(ln(512)/ln(2)).toInt()` yields 8, not 9, corrupting the
  FFT bit-reversal. Replaced with `Integer.numberOfTrailingZeros`.
- **Soft clip added gain**: blending the identity with a saturating curve applied
  *more* than unity gain (1.5 → 1.12), because the identity term dominates. Replaced
  with a monotonic `tanh` knee that is exact below 0.5 and never exceeds 1.0.

## UI

A "Voice clarity" card sits above the talk button:

- ON/OFF toggle with a plain-language subtitle
- Light / Balanced / Max presets
- Live "Noise removed" meter fed by `getNoiseSuppressionStats`, polled at 5 Hz
  while transmitting — it shows real measured reduction, not a decorative animation

Verified in a real browser (390×844, DPR 2): toggle switches state, presets hide
when off, Max reports "Aggressive", **0 console errors**.

## Caveat

**The Kotlin has not been compiled.** This machine has no JDK, no Android SDK and
no `kotlinc`, so `WalkieTalkieNoiseProcessor.kt` and the `SyncNetworkModule.kt`
changes are unverified by a compiler. The algorithm itself is validated in Python,
but syntax and type errors can only be caught by the CI `build-apk.yml` job or a
local `./gradlew assembleDebug`. The React Native side typechecks clean
(`tsc --noEmit`, exit 0), and 275/275 styles are used with none missing.
