const EventEmitter = require("events");

class AriaEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emitEvent(type, data = {}) {
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    this.emit("event", payload);
    return payload;
  }
}

const ariaEventBus = new AriaEventBus();

module.exports = ariaEventBus;
