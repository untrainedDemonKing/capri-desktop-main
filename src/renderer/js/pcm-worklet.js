// Her ears' tap on the microphone (ears.js loads this as an audio worklet): hands over what the mic hears, as samples,
// a tenth of a second at a time, so that what you said just before she noticed can be kept.
/* global AudioWorkletProcessor, sampleRate, registerProcessor */
class CapriPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(512, Math.round(sampleRate / 10));
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buf[this.n++] = channel[i];
        if (this.n === this.size) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('capri-pcm', CapriPcm);
