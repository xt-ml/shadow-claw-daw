/**
 * test/helpers/fake-audio-context.mjs
 *
 * Minimal mock of Web Audio API AudioContext & nodes for Node.js unit testing.
 */

class FakeAudioParam {
  constructor(defaultValue = 1) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(val, time) {
    this.events.push({ type: "setValueAtTime", val, time });
    this.value = val;
  }
  linearRampToValueAtTime(val, time) {
    this.events.push({ type: "linearRampToValueAtTime", val, time });
    this.value = val;
  }
  exponentialRampToValueAtTime(val, time) {
    this.events.push({ type: "exponentialRampToValueAtTime", val, time });
    this.value = val;
  }
  setTargetAtTime(val, time, constant) {
    this.events.push({ type: "setTargetAtTime", val, time, constant });
    this.value = val;
  }
}

class FakeAudioNode {
  constructor(ctx) {
    this.context = ctx;
    this.inputs = [];
    this.outputs = [];
  }
  connect(dest) {
    this.outputs.push(dest);
    if (dest && dest.inputs) dest.inputs.push(this);
    return dest;
  }
  disconnect() {
    this.outputs = [];
  }
}

class FakeGainNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.gain = new FakeAudioParam(1);
  }
}

class FakeStereoPannerNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.pan = new FakeAudioParam(0);
  }
}

class FakeBiquadFilterNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.frequency = new FakeAudioParam(1000);
    this.Q = new FakeAudioParam(1);
    this.type = "lowpass";
  }
}

class FakeOscillatorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.frequency = new FakeAudioParam(440);
    this.detune = new FakeAudioParam(0);
    this.type = "sine";
    this.started = false;
    this.stopped = false;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopped = true;
    this.stopTime = when;
    if (this.onended) {
      setTimeout(() => this.onended(), 10);
    }
  }
}

class FakeAnalyserNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.fftSize = 2048;
  }
  getFloatTimeDomainData(array) {
    array.fill(0);
  }
  getByteTimeDomainData(array) {
    array.fill(128);
  }
}

class FakeDynamicsCompressorNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.threshold = new FakeAudioParam(-24);
    this.knee = new FakeAudioParam(30);
    this.ratio = new FakeAudioParam(12);
    this.attack = new FakeAudioParam(0.003);
    this.release = new FakeAudioParam(0.25);
  }
}

class FakeWaveShaperNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.curve = null;
    this.oversample = "none";
  }
}

class FakeDelayNode extends FakeAudioNode {
  constructor(ctx, maxDelay = 1) {
    super(ctx);
    this.delayTime = new FakeAudioParam(0);
    this.maxDelay = maxDelay;
  }
}

class FakeAudioBufferSourceNode extends FakeAudioNode {
  constructor(ctx) {
    super(ctx);
    this.playbackRate = new FakeAudioParam(1);
    this.buffer = null;
  }
  start(when = 0) {
    this.startTime = when;
  }
  stop(when = 0) {
    this.stopTime = when;
    if (this.onended) setTimeout(() => this.onended(), 10);
  }
}

export class FakeAudioContext extends EventTarget {
  constructor({ sampleRate = 44100 } = {}) {
    super();
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeAudioNode(this);
  }

  createGain() {
    return new FakeGainNode(this);
  }
  createStereoPanner() {
    return new FakeStereoPannerNode(this);
  }
  createBiquadFilter() {
    return new FakeBiquadFilterNode(this);
  }
  createOscillator() {
    return new FakeOscillatorNode(this);
  }
  createAnalyser() {
    return new FakeAnalyserNode(this);
  }
  createDynamicsCompressor() {
    return new FakeDynamicsCompressorNode(this);
  }
  createWaveShaper() {
    return new FakeWaveShaperNode(this);
  }
  createDelay(maxDelay = 1) {
    return new FakeDelayNode(this, maxDelay);
  }
  createBufferSource() {
    return new FakeAudioBufferSourceNode(this);
  }
  createMediaStreamSource(stream) {
    const node = new FakeAudioNode(this);
    node.mediaStream = stream;
    return node;
  }
  async decodeAudioData(arrayBuffer) {
    let length = Math.round(this.sampleRate * 1.0);
    let channels = 2;
    let sampleRate = this.sampleRate;
    if (arrayBuffer && arrayBuffer.byteLength >= 44) {
      const view = new DataView(arrayBuffer);
      const ch = view.getUint16(22, true);
      const sr = view.getUint32(24, true);
      const bps = view.getUint16(34, true);
      const dataBytes = arrayBuffer.byteLength - 44;
      if (ch > 0 && sr > 0 && bps > 0) {
        channels = ch;
        sampleRate = sr;
        length = Math.floor(dataBytes / (ch * (bps / 8)));
      }
    }
    const buf = this.createBuffer(channels, Math.max(1, length), sampleRate);
    buf.duration = length / sampleRate;
    return buf;
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }

  async resume() {
    this.state = "running";
  }

  async suspend() {
    this.state = "suspended";
  }

  async close() {
    this.state = "closed";
  }
}

export class FakeOfflineAudioContext extends FakeAudioContext {
  constructor(channels, length, sampleRate) {
    super({ sampleRate });
    this.channels = channels;
    this.length = length;
  }

  async startRendering() {
    return this.createBuffer(this.channels, this.length, this.sampleRate);
  }
}
