#!/usr/bin/env python3
"""Cleans a recording of a voice before it is given to Capri as her voice (Chatterbox copies it, noise and all).

    python tools/clean-voice.py in.wav out.wav

What it does, in this order: mono, 24 kHz (what Chatterbox works at); a high-pass at 70 Hz (rumble, DC); a gentle spectral
gate whose noise profile is the quietest 8 % of the recording; the silence at both ends cut down to 120 ms; a short fade at both
ends; the peak at -1 dBFS. It does not remove music or other voices: do that first with a vocal separator (for example
`pip install audio-separator`, then `audio-separator in.mp3 --model_filename model_bs_roformer_ep_317_sdr_12.9755.ckpt
--single_stem vocals`). Needs: pip install numpy scipy librosa soundfile noisereduce
"""
import sys

import librosa
import noisereduce
import numpy as np
import scipy.signal as signal
import soundfile

RATE = 24000


def clean(x, rate):
    x = x.mean(axis=1) if x.ndim > 1 else x
    x = librosa.resample(x.astype(np.float32), orig_sr=rate, target_sr=RATE) if rate != RATE else x.astype(np.float32)
    x = signal.sosfiltfilt(signal.butter(4, 70, 'hp', fs=RATE, output='sos'), x).astype(np.float32)
    frame = int(0.02 * RATE)
    count = len(x) // frame
    level = np.array([np.sqrt(np.mean(x[i * frame:(i + 1) * frame] ** 2)) for i in range(count)])
    quiet = sorted(np.argsort(level)[:max(8, int(count * 0.08))])
    profile = np.concatenate([x[i * frame:(i + 1) * frame] for i in quiet])
    x = noisereduce.reduce_noise(y=x, sr=RATE, y_noise=profile, stationary=True, prop_decrease=0.7, n_fft=1024,
                                 freq_mask_smooth_hz=300, time_mask_smooth_ms=60).astype(np.float32)
    active = np.where(np.abs(x) > 0.02 * np.abs(x).max())[0]
    x = x[max(0, active[0] - int(0.12 * RATE)):min(len(x), active[-1] + int(0.12 * RATE))]
    fade = int(0.015 * RATE)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x * (0.891 / np.abs(x).max())


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    data, rate = soundfile.read(sys.argv[1], always_2d=True)
    soundfile.write(sys.argv[2], clean(data, rate), RATE, subtype='PCM_16')
