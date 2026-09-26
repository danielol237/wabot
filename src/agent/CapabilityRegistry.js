// Central Authoritative Capability Catalog for ARIA Agent Architecture
const path = require("path");
const { log, warn, error } = require("../utils/logger");

class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
    this.registerCoreCapabilities();
  }

  registerCoreCapabilities() {
    // 1. Terminal Capabilities
    this.register({
      name: "terminal.execute",
      description: "Execute a command in the terminal workspace under policy control.",
      category: "terminal",
      inputs: ["command", "timeoutMs", "userAuthorized"],
      outputs: ["exitCode", "stdout", "stderr", "duration", "timedOut"],
      prerequisites: [],
      risk: "AUTHORIZED_WRITE",
      authorization: "POLICY_OR_USER",
      environment: "HOST",
      sideEffects: true,
      verification: "exitCode === 0",
      handler: async (args, ctx) => {
        const CommandRunner = require("../coding/execution/CommandRunner");
        const runner = new CommandRunner(ctx?.workspacePath || process.cwd());
        return await runner.runCommand(args.command, args.timeoutMs, { userAuthorized: args.userAuthorized });
      },
    });

    this.register({
      name: "terminal.observe",
      description: "Inspect running processes, service statuses, or system metrics without modifying state.",
      category: "terminal",
      inputs: ["command"],
      outputs: ["stdout", "stderr"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "HOST",
      sideEffects: false,
      verification: "stdout.length > 0",
      handler: async (args, ctx) => {
        const CommandRunner = require("../coding/execution/CommandRunner");
        const runner = new CommandRunner(ctx?.workspacePath || process.cwd());
        return await runner.runCommand(args.command || "git status", args.timeoutMs || 15000);
      },
    });

    // 2. Filesystem Capabilities
    this.register({
      name: "filesystem.read",
      description: "Read a file from the workspace safely.",
      category: "filesystem",
      inputs: ["path"],
      outputs: ["content"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: false,
      verification: "content !== undefined",
      handler: async (args, ctx) => {
        const FileManager = require("../coding/execution/FileManager");
        const fm = new FileManager(ctx?.workspacePath || process.cwd());
        return { content: fm.readFile(args.path) };
      },
    });

    this.register({
      name: "filesystem.write",
      description: "Write or update a file in the workspace safely.",
      category: "filesystem",
      inputs: ["path", "content"],
      outputs: ["success"],
      prerequisites: [],
      risk: "LOW_RISK_WRITE",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: true,
      verification: "file_exists",
      handler: async (args, ctx) => {
        const FileManager = require("../coding/execution/FileManager");
        const fm = new FileManager(ctx?.workspacePath || process.cwd());
        fm.writeFile(args.path, args.content);
        return { success: true };
      },
    });

    // 3. Git Capabilities
    this.register({
      name: "git.status",
      description: "Check working tree status of repository.",
      category: "git",
      inputs: [],
      outputs: ["statusStr", "clean"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "HOST",
      sideEffects: false,
      verification: "statusStr !== undefined",
      handler: async (args, ctx) => {
        const GitManager = require("../coding/execution/GitManager");
        const gm = new GitManager(ctx?.workspacePath || process.cwd());
        return await gm.getStatus();
      },
    });

    this.register({
      name: "git.commit",
      description: "Commit staged workspace changes.",
      category: "git",
      inputs: ["message"],
      outputs: ["hash", "stdout"],
      prerequisites: ["git.status"],
      risk: "AUTHORIZED_WRITE",
      authorization: "POLICY_OR_USER",
      environment: "HOST",
      sideEffects: true,
      verification: "hash !== undefined",
      handler: async (args, ctx) => {
        const GitManager = require("../coding/execution/GitManager");
        const gm = new GitManager(ctx?.workspacePath || process.cwd());
        return await gm.commit(args.message || "update: commit from ARIA agent");
      },
    });

    // 4. Software Engineering Capabilities
    this.register({
      name: "coding.build_app",
      description: "Delegate a full software engineering request to the authoritative ARIA Coding Subsystem.",
      category: "coding",
      inputs: ["request"],
      outputs: ["taskId", "status", "workspacePath", "result"],
      prerequisites: [],
      risk: "AUTHORIZED_WRITE",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: true,
      verification: "taskId !== undefined",
      handler: async (args, ctx) => {
        const codingSubsystem = require("../coding");
        await codingSubsystem.initialize();

        const requestText = args.request || ctx.objective || "build a website";
        const initRes = await codingSubsystem.handleCodingRequest(requestText, {
          userId: ctx?.userId || "anonymous",
          chatId: ctx?.chatId || null,
        });

        const taskId = initRes.taskId;
        if (!taskId) {
          throw new Error("CodingSubsystem failed to generate a taskId");
        }

        // Observe task completion on authoritative TaskManager
        const taskResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            resolve({ taskId, status: "TIMEOUT" });
          }, 120000);

          const onCompleted = (evt) => {
            if (evt.taskId === taskId) {
              cleanup();
              const task = codingSubsystem.engine.getTask(taskId);
              resolve({
                taskId,
                status: "COMPLETED",
                workspacePath: task?.workspace || process.cwd(),
                result: task,
              });
            }
          };

          const onFailed = (evt) => {
            if (evt.taskId === taskId) {
              cleanup();
              reject(new Error(evt.error || "Coding task failed"));
            }
          };

          const cleanup = () => {
            clearTimeout(timeout);
            codingSubsystem.engine.taskManager.removeListener("task.completed", onCompleted);
            codingSubsystem.engine.taskManager.removeListener("task.failed", onFailed);
          };

          codingSubsystem.engine.taskManager.on("task.completed", onCompleted);
          codingSubsystem.engine.taskManager.on("task.failed", onFailed);
        });

        return taskResult;
      },
    });

    this.register({
      name: "coding.modify",
      description: "Modify code files to satisfy feature or bugfix requirements.",
      category: "coding",
      inputs: ["request", "targetFiles"],
      outputs: ["filesChanged", "workspacePath"],
      prerequisites: ["filesystem.read"],
      risk: "AUTHORIZED_WRITE",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: true,
      verification: "filesChanged.length > 0",
      handler: async (args, ctx) => {
        const LocalCodingProvider = require("../coding/providers/LocalCodingProvider");
        const provider = new LocalCodingProvider(ctx?.workspacePath || process.cwd());
        return await provider.executeTask({ request: args.request, id: ctx?.taskId }, ctx?.emitProgress);
      },
    });

    this.register({
      name: "coding.verify",
      description: "Verify build, unit tests, and HTTP runtime probes for code.",
      category: "coding",
      inputs: ["testScript", "buildScript"],
      outputs: ["success", "evidence"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: false,
      verification: "success === true",
      handler: async (args, ctx) => {
        const VerificationEngine = require("../coding/verification/VerificationEngine");
        const ve = new VerificationEngine(ctx?.workspacePath || process.cwd());
        const res = await ve.verify(args);
        return { success: res.success, evidence: res };
      },
    });

    // 5. Web & Security Capabilities
    this.register({
      name: "web.search",
      description: "Perform real-time web search for facts, documentation, or news.",
      category: "web",
      inputs: ["query"],
      outputs: ["results"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "HOST",
      sideEffects: false,
      verification: "results !== undefined",
      handler: async (args) => {
        const { searchWeb } = require("../tools/webSearch");
        return { results: await searchWeb(args.query) };
      },
    });

    this.register({
      name: "web.fetch",
      description: "Fetch web content or snapshot webpage details.",
      category: "web",
      inputs: ["url"],
      outputs: ["title", "content"],
      prerequisites: [],
      risk: "READ",
      authorization: "NONE",
      environment: "HOST",
      sideEffects: false,
      verification: "content !== undefined",
      handler: async (args) => {
        const { scrapePage } = require("../tools/scraper");
        const res = await scrapePage(args.url);
        return { title: res.title, content: res.text || res.content };
      },
    });

    // 6. Artifact & Delivery Capabilities
    this.register({
      name: "artifact.create",
      description: "Generate and store an artifact file (report, log, markdown, code).",
      category: "artifact",
      inputs: ["filename", "content", "type"],
      outputs: ["artifactId", "filepath"],
      prerequisites: [],
      risk: "LOW_RISK_WRITE",
      authorization: "NONE",
      environment: "SANDBOX",
      sideEffects: true,
      verification: "filepath !== undefined",
      handler: async (args, ctx) => {
        const ArtifactManager = require("./ArtifactManager");
        const am = new ArtifactManager(ctx?.workspacePath);
        return am.createArtifact(args.filename, args.content, args.type);
      },
    });

    this.register({
      name: "whatsapp.sendMessage",
      description: "Send a message or artifact notification to a WhatsApp chat.",
      category: "whatsapp",
      inputs: ["message", "chatId"],
      outputs: ["sent"],
      prerequisites: [],
      risk: "LOW_RISK_WRITE",
      authorization: "NONE",
      environment: "HOST",
      sideEffects: true,
      verification: "sent === true",
      handler: async (args, ctx) => {
        if (ctx?.sock && args.chatId) {
          await ctx.sock.sendMessage(args.chatId, { text: args.message });
          return { sent: true };
        }
        return { sent: false, reason: "Socket or chatId unavailable in context" };
      },
    });
  }

  register(cap) {
    if (!cap || !cap.name || !cap.handler) {
      throw new Error("Invalid capability registration: name and handler required.");
    }
    this.capabilities.set(cap.name, {
      ...cap,
      available: true,
    });
  }

  getCapability(name) {
    return this.capabilities.get(name) || null;
  }

  hasCapability(name) {
    return this.capabilities.has(name);
  }

  listCapabilities() {
    return Array.from(this.capabilities.values());
  }

  async executeCapability(name, args = {}, ctx = {}) {
    const cap = this.getCapability(name);
    if (!cap) {
      throw new Error(`Capability not found in registry: '${name}'`);
    }
    if (!cap.available) {
      throw new Error(`Capability '${name}' is currently unavailable.`);
    }

    log(`[CapabilityRegistry] Executing capability: ${name}`);
    try {
      return await cap.handler(args, ctx);
    } catch (err) {
      error(`[CapabilityRegistry] Capability '${name}' failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = new CapabilityRegistry();
