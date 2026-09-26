// Reusable Artifact Storage & Lifecycle Manager for ARIA Agent
const fs = require("fs");
const path = require("path");

const ARTIFACT_DIR = path.join(__dirname, "../../data/artifacts");

function ensureDirectory(dir = ARTIFACT_DIR) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class ArtifactManager {
  constructor(workspacePath = ARTIFACT_DIR) {
    this.workspacePath = workspacePath;
    ensureDirectory(this.workspacePath);
  }

  createArtifact(filename, content, type = "txt") {
    ensureDirectory(this.workspacePath);
    const sanitizedName = String(filename || `artifact_${Date.now()}`).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const fullPath = path.join(this.workspacePath, sanitizedName);

    fs.writeFileSync(fullPath, content, "utf8");

    const artifactId = `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    return {
      artifactId,
      filename: sanitizedName,
      filepath: fullPath,
      type,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      createdAt: new Date().toISOString(),
    };
  }

  getArtifact(filename) {
    const fullPath = path.join(this.workspacePath, filename);
    if (fs.existsSync(fullPath)) {
      return {
        filename,
        filepath: fullPath,
        content: fs.readFileSync(fullPath, "utf8"),
      };
    }
    return null;
  }
}

module.exports = ArtifactManager;
