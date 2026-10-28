#!/usr/bin/env python3
"""Capri's own little speech server around the Chatterbox library.

Capri (src/main/chatterbox.js) starts this with the Python that has `chatterbox-tts` installed (the one in
your Chatterbox folder), waits for /health to say it is ready, and asks it for her lines:

  GET  /health                 -> {"ok": true, "ready": bool, "device": "cuda", "error": null}
  POST /v1/audio/speech        {"input": "...", "voice": "", "language": "ru", "exaggeration": 0.5,
                                "cfg_weight": 0.5, "temperature": 0.8}   -> audio/wav

It is OpenAI's speech endpoint, so any client for that works too. `voice` is optional: the name of a recording
in the voices folders (or a path to one) whose voice she should have; empty is the model's own voice. Use a
voice you have the right to use.

Only the standard library, the Chatterbox package and numpy are needed. Started with --watch-stdin (as Capri does), we
exit when our stdin closes, which is when Capri stops or crashes, so no server is left running.

  python chatterbox-server.py --port 8620 [--device auto|cuda|cpu|mps] [--voices DIR ...] [--watch-stdin]
"""
import argparse
import hashlib
import inspect
import io
import json
import os
import re
import sys
import tempfile
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LANGUAGES = set('ar da de el en es fi fr he hi it ja ko ms nl no pl pt ru sv sw tr zh'.split())
CHUNK = 260       # characters: the model is at its best on a sentence or two at a time
PAUSE = 0.14      # seconds of silence between two pieces
REFERENCE = 20    # seconds of a recording the voice is taken from: more only makes every line slower

state = {'ready': False, 'error': None, 'device': None, 'multilingual': True}
model = None
generate_lock = threading.Lock()
voice_dirs = []


def log(*parts):
    print('capri-chatterbox:', *parts, flush=True)


def split_text(text, limit=CHUNK):
    """The text in pieces of a sentence or two (never longer than `limit`, cut at a comma or a space)."""
    out, current = [], ''
    for sentence in re.split(r'(?<=[.!?…])\s+', text.strip()):
        if not sentence:
            continue
        if len(current) + len(sentence) + 1 <= limit:
            current = f'{current} {sentence}'.strip()
            continue
        if current:
            out.append(current)
        while len(sentence) > limit:
            cut = max(sentence.rfind(',', 0, limit), sentence.rfind(' ', 0, limit))
            cut = cut if cut > 40 else limit
            out.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip(' ,')
        current = sentence
    if current:
        out.append(current)
    return out


def find_voice(name):
    """A recording to take the voice from: a path, or a name in one of the voices folders. None: the model's own."""
    name = (name or '').strip()
    if not name or name.lower() in ('default', 'none'):
        return None
    candidates = [name] + [os.path.join(d, name) for d in voice_dirs]
    for base in candidates:
        for ext in ('', '.wav', '.mp3', '.flac', '.ogg'):
            if os.path.isfile(base + ext):
                return base + ext
    return None


def reference(path):
    """The recording to take the voice from: itself, or its first REFERENCE seconds when it is longer (a copy in the
    temp folder, made once). Whatever cannot be read here is left to the model, which says what is wrong with it."""
    try:
        import soundfile
        info = soundfile.info(path)
        if info.duration <= REFERENCE + 1:
            return path
        key = hashlib.md5(f'{path}|{os.path.getmtime(path)}|{os.path.getsize(path)}'.encode('utf-8')).hexdigest()[:16]
        out = os.path.join(tempfile.gettempdir(), f'capri-voice-{key}.wav')
        if not os.path.isfile(out):
            data, rate = soundfile.read(path, frames=int(info.samplerate * REFERENCE))
            soundfile.write(out + '.part', data, rate, format='WAV')
            os.replace(out + '.part', out)
        return out
    except Exception as err:  # noqa: BLE001 - no soundfile, a format it cannot read: the model gets the file as it is
        log('could not shorten the recording:', f'{type(err).__name__}: {err}')
        return path


def load_model(device):
    global model
    try:
        import torch
        if device == 'auto':
            device = 'cuda' if torch.cuda.is_available() else ('mps' if getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available() else 'cpu')
    except ImportError:
        device = 'cpu' if device == 'auto' else device
    state['device'] = device
    log(f'loading the model on {device} (the first time it also downloads, a few GB)')
    try:
        try:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        except ModuleNotFoundError as err:
            # only when the multilingual module itself is missing (an older package: English only); a
            # missing dependency inside it is a real problem and is shown as it is
            if err.name not in ('chatterbox', 'chatterbox.mtl_tts'):
                raise
            from chatterbox.tts import ChatterboxTTS
            model = ChatterboxTTS.from_pretrained(device=device)
            state['multilingual'] = False
        state['ready'] = True
        log(f'ready on {device}')
    except ModuleNotFoundError as err:
        if err.name == 'chatterbox':
            state['error'] = f'chatterbox-tts is not installed in this Python ({sys.executable}): pip install chatterbox-tts'
        else:
            state['error'] = f'ModuleNotFoundError: {err}'[:300]
        log('could not load the model:', state['error'])
    except Exception as err:  # noqa: BLE001 - whatever went wrong is shown in Capri's menu
        state['error'] = f'{type(err).__name__}: {err}'[:300]
        log('could not load the model:', state['error'])


def pcm(wav):
    import numpy as np
    arr = wav.squeeze().detach().cpu().numpy().astype('float32')
    return (np.clip(arr, -1.0, 1.0) * 32767).astype('<i2')


def synthesize(request):
    text = str(request.get('input') or '').strip()
    if not text:
        raise ValueError('nothing to say')
    options = {
        'exaggeration': request.get('exaggeration'),
        'cfg_weight': request.get('cfg_weight'),
        'temperature': request.get('temperature'),
    }
    language = str(request.get('language') or 'en').lower()[:2]
    if language not in LANGUAGES:
        language = 'en'
    prompt = find_voice(request.get('voice'))
    if prompt:
        prompt = reference(prompt)
    accepted = inspect.signature(model.generate).parameters
    kwargs = {k: float(v) for k, v in options.items() if v is not None and k in accepted}
    if state['multilingual'] and 'language_id' in accepted:
        kwargs['language_id'] = language
    if prompt and 'audio_prompt_path' in accepted:
        kwargs['audio_prompt_path'] = prompt
    import numpy as np
    pieces = []
    gap = np.zeros(int(getattr(model, 'sr', 24000) * PAUSE), dtype='<i2')
    with generate_lock:  # one at a time: the card has one pair of hands
        for part in split_text(text):
            if pieces:
                pieces.append(gap)
            pieces.append(pcm(model.generate(part, **kwargs)))
    samples = np.concatenate(pieces) if pieces else np.zeros(1, dtype='<i2')
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(getattr(model, 'sr', 24000)))
        out.writeframes(samples.tobytes())
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = 'CapriChatterbox/1'

    def log_message(self, *args):  # (no line per request on the console)
        pass

    def send(self, code, body, kind='application/json'):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] in ('/health', '/v1/health'):
            self.send(200, {'ok': True, **{k: state[k] for k in ('ready', 'device', 'error')}})
        else:
            self.send(404, {'error': {'message': 'not found'}})

    def do_POST(self):
        if self.path.split('?')[0] not in ('/v1/audio/speech', '/audio/speech'):
            return self.send(404, {'error': {'message': 'not found'}})
        if state['error']:
            return self.send(500, {'error': {'message': state['error']}})
        if not state['ready']:
            return self.send(503, {'error': {'message': 'the model is still loading'}})
        try:
            size = int(self.headers.get('Content-Length') or 0)
            request = json.loads(self.rfile.read(size) or b'{}')
            audio = synthesize(request)
        except ValueError as err:
            return self.send(400, {'error': {'message': str(err)}})
        except Exception as err:  # noqa: BLE001
            log('speech failed:', f'{type(err).__name__}: {err}')
            return self.send(500, {'error': {'message': f'{type(err).__name__}: {err}'[:300]}})
        return self.send(200, audio, 'audio/wav')


def exit_with_parent():
    """Capri keeps our stdin open; when it is gone (it quit, or crashed) so are we."""
    try:
        while sys.stdin.read(4096):
            pass
    except Exception:  # noqa: BLE001
        pass
    os._exit(0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8620)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--device', default='auto')
    parser.add_argument('--voices', action='append', default=[])
    parser.add_argument('--watch-stdin', action='store_true', help='exit when stdin closes (Capri starts us this way)')
    args = parser.parse_args()
    voice_dirs.extend(d for d in args.voices if d)
    if args.watch_stdin:
        threading.Thread(target=exit_with_parent, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    threading.Thread(target=load_model, args=(args.device,), daemon=True).start()
    log(f'listening on http://{args.host}:{args.port}')
    server.serve_forever()


if __name__ == '__main__':
    main()
