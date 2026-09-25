// ARIA Media Provider Abstraction Layer
// Standardizes Metadata, Availability, Playback, and Download providers across all media categories (Anime, Movies, Series, Cartoons, Kids).

class BaseMediaProvider {
  constructor(config = {}) {
    this.id = config.id || "base";
    this.name = config.name || "Base Provider";
    this.category = config.category || "all"; // anime, movie, series, cartoon, kids, or all
    this.capabilities = {
      search: true,
      getDetails: true,
      getEpisodes: true,
      getAvailability: true,
      resolvePlayback: true,
      resolveDownload: true,
      checkHealth: true,
      ...config.capabilities,
    };
  }

  async search(query, options = {}) {
    throw new Error(`search() not implemented for provider ${this.id}`);
  }

  async getDetails(id, options = {}) {
    throw new Error(`getDetails() not implemented for provider ${this.id}`);
  }

  async getEpisodes(id, options = {}) {
    return [];
  }

  async getAvailability(id, episode = 1, options = {}) {
    return { available: false, playback: false, download: false, sources: [] };
  }

  async resolvePlayback(id, episode = 1, quality = "best", options = {}) {
    return { ok: false, error: "Playback not supported by this provider" };
  }

  async resolveDownload(id, episode = 1, quality = "best", options = {}) {
    return { ok: false, error: "Download not supported by this provider" };
  }

  async checkHealth() {
    return { ok: true, status: "healthy", latencyMs: 0 };
  }
}

class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    if (!provider || !provider.id) throw new Error("Invalid provider registration");
    this.providers.set(provider.id, provider);
  }

  get(id) {
    return this.providers.get(id) || null;
  }

  getAllForCategory(category) {
    const list = [];
    for (const p of this.providers.values()) {
      if (p.category === "all" || p.category === category) {
        list.push(p);
      }
    }
    return list;
  }
}

const registry = new ProviderRegistry();

module.exports = {
  BaseMediaProvider,
  registry,
};
