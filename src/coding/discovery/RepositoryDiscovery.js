// Repository Discovery & Project Metadata Inspector
const fs = require("fs");
const path = require("path");

class RepositoryDiscovery {
  constructor(rootPath = process.cwd()) {
    this.rootPath = rootPath;
  }

  inspect() {
    const rootFiles = this.listDir(this.rootPath, 1);
    const packageJson = this.readJson("package.json");
    const scripts = packageJson?.scripts || {};
    const dependencies = {
      ...(packageJson?.dependencies || {}),
      ...(packageJson?.devDependencies || {}),
    };

    const projectType = this.detectProjectType(rootFiles, packageJson, dependencies);
    const testFramework = this.detectTestFramework(scripts, dependencies);
    const buildSystem = this.detectBuildSystem(scripts, dependencies);

    return {
      rootPath: this.rootPath,
      projectName: packageJson?.name || path.basename(this.rootPath),
      version: packageJson?.version || "0.0.0",
      projectType,
      scripts,
      testFramework,
      buildSystem,
      entryPoints: this.detectEntryPoints(packageJson, rootFiles),
      keyFiles: this.findKeyFiles(rootFiles),
      hasGit: fs.existsSync(path.join(this.rootPath, ".git")),
    };
  }

  listDir(dir, depth = 1) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      const results = [];
      for (const item of items) {
        if (item.name === "node_modules" || item.name === ".git") continue;
        const rel = path.relative(this.rootPath, path.join(dir, item.name));
        results.push({
          name: item.name,
          path: rel,
          isDirectory: item.isDirectory(),
        });
      }
      return results;
    } catch (_) {
      return [];
    }
  }

  readJson(file) {
    try {
      const p = path.join(this.rootPath, file);
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch (_) {}
    return null;
  }

  detectProjectType(rootFiles, packageJson, dependencies) {
    if (packageJson) return "nodejs";
    if (fs.existsSync(path.join(this.rootPath, "requirements.txt")) || fs.existsSync(path.join(this.rootPath, "pyproject.toml"))) return "python";
    if (fs.existsSync(path.join(this.rootPath, "Cargo.toml"))) return "rust";
    if (fs.existsSync(path.join(this.rootPath, "go.mod"))) return "go";
    return "generic";
  }

  detectTestFramework(scripts, dependencies) {
    if (scripts.test && scripts.test.includes("node --test")) return "node-native";
    if (dependencies.jest || scripts.test?.includes("jest")) return "jest";
    if (dependencies.mocha || scripts.test?.includes("mocha")) return "mocha";
    if (dependencies.vitest || scripts.test?.includes("vitest")) return "vitest";
    if (scripts.test) return "custom";
    return "none";
  }

  detectBuildSystem(scripts, dependencies) {
    if (scripts.build) return "npm-build";
    if (dependencies.webpack) return "webpack";
    if (dependencies.vite) return "vite";
    if (dependencies.esbuild) return "esbuild";
    return "none";
  }

  detectEntryPoints(packageJson, rootFiles) {
    const entries = [];
    if (packageJson?.main) entries.push(packageJson.main);
    if (fs.existsSync(path.join(this.rootPath, "index.js"))) entries.push("index.js");
    if (fs.existsSync(path.join(this.rootPath, "src/index.js"))) entries.push("src/index.js");
    if (fs.existsSync(path.join(this.rootPath, "src/app.js"))) entries.push("src/app.js");
    if (fs.existsSync(path.join(this.rootPath, "src/main.js"))) entries.push("src/main.js");
    return Array.from(new Set(entries));
  }

  findKeyFiles(rootFiles) {
    const targets = ["package.json", "README.md", "Dockerfile", "ecosystem.config.js", ".env.example"];
    return rootFiles.filter((f) => targets.includes(f.name)).map((f) => f.path);
  }
}

module.exports = RepositoryDiscovery;
