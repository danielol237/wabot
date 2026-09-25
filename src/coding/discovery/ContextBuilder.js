// Focused Context Builder for Coding Tasks
const fs = require("fs");
const path = require("path");
const RepositoryDiscovery = require("./RepositoryDiscovery");
const CodebaseIndexer = require("./CodebaseIndexer");

class ContextBuilder {
  constructor(rootPath = process.cwd(), options = {}) {
    this.rootPath = rootPath;
    this.maxContextBytes = options.maxContextBytes || 64000;
  }

  buildContext(userRequest, hintFiles = []) {
    const discovery = new RepositoryDiscovery(this.rootPath).inspect();
    const indexer = new CodebaseIndexer(this.rootPath);

    // Auto-search relevant files based on user request keywords
    const keywords = String(userRequest || "")
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);

    const matchedFiles = new Set(hintFiles);
    for (const kw of keywords) {
      const hits = indexer.searchFiles(kw);
      for (const h of hits.slice(0, 5)) {
        matchedFiles.add(h.path);
      }
    }

    const fileContents = [];
    let currentBytes = 0;

    // Always include key metadata files first
    const priorityFiles = ["package.json", ...discovery.entryPoints, ...Array.from(matchedFiles)];

    for (const relPath of priorityFiles) {
      if (currentBytes >= this.maxContextBytes) break;
      const fullPath = path.join(this.rootPath, relPath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const truncated = content.slice(0, 10000); // 10kb per file max
          fileContents.push({
            path: relPath,
            content: truncated,
          });
          currentBytes += truncated.length;
        } catch (_) {}
      }
    }

    return {
      discovery,
      relevantFiles: fileContents,
      totalContextBytes: currentBytes,
    };
  }
}

module.exports = ContextBuilder;
