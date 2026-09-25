// Recursive File Catalog & Symbol / Path Searcher
const fs = require("fs");
const path = require("path");

class CodebaseIndexer {
  constructor(rootPath = process.cwd(), options = {}) {
    this.rootPath = rootPath;
    this.excludes = new Set(options.excludes || [
      "node_modules",
      ".git",
      "dist",
      "build",
      "temp",
      "data",
      "coverage",
    ]);
    this.maxFiles = options.maxFiles || 1000;
  }

  index() {
    const files = [];
    this.walk(this.rootPath, files);
    return {
      totalFiles: files.length,
      files,
    };
  }

  walk(dir, files) {
    if (files.length >= this.maxFiles) return;

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (files.length >= this.maxFiles) break;
        if (this.excludes.has(item.name)) continue;

        const fullPath = path.join(dir, item.name);
        const relPath = path.relative(this.rootPath, fullPath).replace(/\\/g, "/");

        if (item.isDirectory()) {
          this.walk(fullPath, files);
        } else if (item.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            files.push({
              path: relPath,
              size: stat.size,
              ext: path.extname(item.name).toLowerCase(),
            });
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  searchFiles(query) {
    const { files } = this.index();
    const clean = String(query || "").toLowerCase().trim();
    if (!clean) return [];
    return files.filter((f) => f.path.toLowerCase().includes(clean));
  }
}

module.exports = CodebaseIndexer;
