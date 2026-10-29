// Copies mic samples to the main thread in batches, tagged with the
// AudioContext frame of the first sample so takes line up with playback.
class RecTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    this.startFrame = 0;
    this.on = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush();
        this.on = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  flush() {
    if (!this.n) return;
    this.port.postMessage({ frame: this.startFrame, data: this.buf.slice(0, this.n) });
    this.n = 0;
  }

  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n + ch.length > this.buf.length) this.flush();
      if (this.n === 0) this.startFrame = currentFrame;
      this.buf.set(ch, this.n);
      this.n += ch.length;
    }
    return true;
  }
}

registerProcessor('rec-tap', RecTap);
