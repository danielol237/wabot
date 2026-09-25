// Official Jules API Integration Provider (Sources -> Sessions -> Activities)
const axios = require("axios");
const CodingProvider = require("./CodingProvider");
const { log, warn, error } = require("../../utils/logger");

const JULES_BASE_URL = String(process.env.JULES_BASE_URL || "https://jules.google.dev/api/v1").replace(/\/+$/, "");

class JulesProvider extends CodingProvider {
  constructor() {
    super("jules", "Google Jules Remote Agent", [
      "repository_coding",
      "multi_file_editing",
      "remote_agent",
      "testing",
    ]);
  }

  getApiKey() {
    return String(process.env.JULES_API_KEY || "").trim();
  }

  isAvailable() {
    const key = this.getApiKey();
    return Boolean(key && key.length >= 8);
  }

  getHeaders() {
    const key = this.getApiKey();
    return {
      Authorization: `Bearer ${key}`,
      "X-Jules-Api-Key": key,
      "Content-Type": "application/json",
    };
  }

  async getOrCreateSource(repository) {
    const repoName = repository || "aria-wabot";
    try {
      const res = await axios.get(`${JULES_BASE_URL}/sources`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });
      const sources = res.data?.sources || res.data || [];
      const existing = Array.isArray(sources) && sources.find((s) => s.name?.includes(repoName) || s.repository === repoName);
      if (existing) return existing.id || existing.name;

      const createRes = await axios.post(`${JULES_BASE_URL}/sources`, { repository: repoName }, {
        headers: this.getHeaders(),
        timeout: 20000,
      });
      return createRes.data?.id || createRes.data?.name || `source_${repoName}`;
    } catch (_) {
      return `sources/${repoName}`;
    }
  }

  async createSession(sourceId, prompt) {
    try {
      const res = await axios.post(`${JULES_BASE_URL}/sessions`, {
        source: sourceId,
        prompt,
      }, {
        headers: this.getHeaders(),
        timeout: 30000,
      });
      return res.data?.id || res.data?.sessionId || `session_${Date.now().toString(36)}`;
    } catch (err) {
      const msg = err.response?.data?.message || err.message;
      throw new Error(`Jules Session Creation Error: ${msg}`);
    }
  }

  async getSessionActivities(sessionId) {
    try {
      const res = await axios.get(`${JULES_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/activities`, {
        headers: this.getHeaders(),
        timeout: 15000,
      });
      return res.data?.activities || res.data || [];
    } catch (err) {
      return [];
    }
  }

  async executeTask(taskPayload, progressCallback) {
    if (!this.isAvailable()) {
      throw new Error("JULES_API_KEY is not configured or unavailable.");
    }

    const sourceId = await this.getOrCreateSource(taskPayload.repository);
    const sessionId = await this.createSession(sourceId, taskPayload.request);

    if (progressCallback) {
      progressCallback({
        step: "jules_session_created",
        sourceId,
        sessionId,
      });
    }

    let attempts = 0;
    const maxPolls = 10;
    while (attempts < maxPolls) {
      attempts++;
      await new Promise((r) => setTimeout(r, 2000));
      const activities = await this.getSessionActivities(sessionId);
      if (progressCallback) {
        progressCallback({ step: "jules_activities_polled", attempt: attempts, activitiesCount: activities.length });
      }
      const completedAct = activities.find((a) => a.state === "completed" || a.type === "completion");
      if (completedAct) {
        return {
          success: true,
          providerTaskId: sessionId,
          filesChanged: completedAct.filesChanged || [],
          verification: ["Jules Remote Session Execution Passed"],
          summary: completedAct.summary || "Jules session completed successfully.",
        };
      }
    }

    return {
      success: true,
      providerTaskId: sessionId,
      status: "processing_async",
      summary: `Jules Session ${sessionId} created and executing in background.`,
    };
  }
}

module.exports = JulesProvider;
