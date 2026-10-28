# A voice that comes with her (optional)

If this folder holds `capri.wav` (or `capri.mp3`, `capri.flac`, `capri.ogg`) when the installer is built, it goes into the
installer, and the first time she starts without a voice recording of her own she takes it as her voice (Chatterbox speaks
with it: `src/main/voice-sample.js`, `adoptBundledVoice` in `main.js`). A taken-away recording does not come back.

`capri.json` says what is spoken in it: `{ "lang": "en" }` or `"ru"`. Chatterbox then does not carry the accent of a recording
in another language into her speech.

Nothing is kept here: the recordings are ignored by git, because they are somebody's voice. Use only a recording you have
the right to use. Without one, the installer simply has no bundled voice.
