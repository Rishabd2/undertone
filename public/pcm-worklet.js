/**
 * Mic capture worklet.
 *
 * Tees one MediaStream two ways, which is the shape the architecture needs:
 *   - 16 kHz linear16 frames for Deepgram
 *   - the same float samples, buffered into windows, for the acoustic channel
 *
 * Both consumers see identical audio. That matters: the transcript and the
 * prosodic features have to be describing the same moment or the side-by-side
 * comparison in the brief is meaningless.
 */

class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions) || {};
    this.targetRate = target.targetSampleRate || 16000;
    this.windowSeconds = target.windowSeconds || 10;
    this.ratio = sampleRate / this.targetRate;
    this.readIndex = 0;
    this.window = [];
    this.windowSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Downsample to the target rate by linear interpolation.
    const out = [];
    while (this.readIndex < channel.length) {
      const i = Math.floor(this.readIndex);
      const frac = this.readIndex - i;
      const a = channel[i];
      const b = i + 1 < channel.length ? channel[i + 1] : a;
      out.push(a + (b - a) * frac);
      this.readIndex += this.ratio;
    }
    this.readIndex -= channel.length;

    if (out.length > 0) {
      // linear16 for Deepgram.
      const pcm = new Int16Array(out.length);
      for (let i = 0; i < out.length; i++) {
        const s = Math.max(-1, Math.min(1, out[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage({ type: "pcm", buffer: pcm.buffer }, [pcm.buffer]);

      // Float copy for the acoustic channel.
      this.window.push(Float32Array.from(out));
      this.windowSamples += out.length;

      if (this.windowSamples >= this.targetRate * this.windowSeconds) {
        const merged = new Float32Array(this.windowSamples);
        let offset = 0;
        for (const chunk of this.window) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.port.postMessage(
          {
            type: "window",
            buffer: merged.buffer,
            sampleRate: this.targetRate,
            seconds: this.windowSamples / this.targetRate,
          },
          [merged.buffer],
        );
        this.window = [];
        this.windowSamples = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-worklet", PCMWorklet);
