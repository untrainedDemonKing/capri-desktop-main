"""Builds a wheel of a stub "chatterbox-tts" for the tests: the same import path as the real package
(chatterbox.mtl_tts.ChatterboxMultilingualTTS) with a tone for a voice, and no network. A wheel is a zip with
a few files in it, so it is made by hand.

  python build-stub-wheel.py path/to/chatterbox_tts-0.0.1-py3-none-any.whl

CB_E2E_LOG (an environment variable, read when the model is asked to speak): a file to append what it was asked
to say, language and feeling, one JSON per line.
"""
import sys
import zipfile

MODEL = '''
import json, os
import numpy as np

class _W:
    def __init__(self, a): self.a = a
    def squeeze(self): return self
    def detach(self): return self
    def cpu(self): return self
    def numpy(self): return self.a

class ChatterboxMultilingualTTS:
    sr = 24000
    @classmethod
    def from_pretrained(cls, device='cpu'):
        return cls()
    def generate(self, text, language_id='en', audio_prompt_path=None, exaggeration=0.5, cfg_weight=0.5, temperature=0.8):
        log = os.environ.get('CB_E2E_LOG')
        if log:
            with open(log, 'a', encoding='utf-8') as f:
                f.write(json.dumps({'text': text, 'language_id': language_id, 'exaggeration': exaggeration}, ensure_ascii=False) + '\\n')
        n = int(self.sr * 0.01 * max(5, len(text)))
        t = np.arange(n) / self.sr
        return _W((0.3 * np.sin(2 * np.pi * 220 * t)).astype('float32'))
'''

files = {
    'chatterbox/__init__.py': '',
    'chatterbox/mtl_tts.py': MODEL,
    'chatterbox_tts-0.0.1.dist-info/METADATA': 'Metadata-Version: 2.1\nName: chatterbox-tts\nVersion: 0.0.1\n',
    'chatterbox_tts-0.0.1.dist-info/WHEEL': 'Wheel-Version: 1.0\nGenerator: by-hand\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
}
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    for name, body in files.items():
        z.writestr(name, body)
    z.writestr('chatterbox_tts-0.0.1.dist-info/RECORD', ''.join(f'{n},,\n' for n in list(files) + ['chatterbox_tts-0.0.1.dist-info/RECORD']))
