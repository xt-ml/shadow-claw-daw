export class FakeMIDIPort {
  constructor({
    id,
    name,
    manufacturer = "FakeCo",
    type = "input",
    state = "connected",
  }) {
    this.id = id;
    this.name = name;
    this.manufacturer = manufacturer;
    this.type = type;
    this.state = state;
    this.connection = "closed";
    this.onmidimessage = null;
    this.sentMessages = [];
  }

  async open() {
    this.connection = "open";
    return this;
  }

  async close() {
    this.connection = "closed";
    return this;
  }

  send(data, timestamp = 0) {
    this.sentMessages.push({
      data: Array.from(data),
      timestamp,
    });
  }

  emitMessage(bytes, timeStamp = Date.now()) {
    if (typeof this.onmidimessage === "function") {
      this.onmidimessage({
        data: new Uint8Array(bytes),
        timeStamp,
        target: this,
      });
    }
  }
}

export class FakeMIDIAccess {
  constructor({ inputs = [], outputs = [], sysexEnabled = false } = {}) {
    this.inputs = new Map(inputs.map((p) => [p.id, p]));
    this.outputs = new Map(outputs.map((p) => [p.id, p]));
    this.sysexEnabled = sysexEnabled;
    this.onstatechange = null;
  }

  connectPort(port) {
    port.state = "connected";
    if (port.type === "input") this.inputs.set(port.id, port);
    else this.outputs.set(port.id, port);
    if (typeof this.onstatechange === "function") {
      this.onstatechange({ port, target: this });
    }
  }

  disconnectPort(portId) {
    const port = this.inputs.get(portId) || this.outputs.get(portId);
    if (!port) return;
    port.state = "disconnected";
    if (port.type === "input") this.inputs.delete(portId);
    else this.outputs.delete(portId);
    if (typeof this.onstatechange === "function") {
      this.onstatechange({ port, target: this });
    }
  }
}
