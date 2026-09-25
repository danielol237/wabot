// Coding Provider Abstract Class
class CodingProvider {
  constructor(id, name, capabilities = []) {
    this.id = id;
    this.name = name;
    this.capabilities = new Set(capabilities);
  }

  isAvailable() {
    throw new Error("Provider must implement isAvailable()");
  }

  hasCapability(capability) {
    return this.capabilities.has(capability);
  }

  async createTask(taskPayload) {
    throw new Error("Provider must implement createTask()");
  }

  async getTaskStatus(taskId) {
    throw new Error("Provider must implement getTaskStatus()");
  }

  async executeTask(taskPayload, progressCallback) {
    throw new Error("Provider must implement executeTask()");
  }
}

module.exports = CodingProvider;
