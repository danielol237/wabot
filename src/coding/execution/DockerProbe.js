// Docker Runtime Probe for Execution Capability Verification
const { exec } = require("child_process");

class DockerProbe {
  static probeRuntime(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      exec("docker run --rm hello-world", { timeout: timeoutMs }, (err, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        if (!err && stdout && /Hello from Docker!/i.test(stdout)) {
          return resolve({
            available: true,
            executable: true,
            failureReason: null,
            durationMs,
          });
        }

        // Fallback probe: docker ps check
        exec("docker ps", { timeout: 5000 }, (psErr, psStdout) => {
          if (!psErr) {
            return resolve({
              available: true,
              executable: true,
              failureReason: err ? `Lightweight hello-world container failed: ${err.message}` : null,
              durationMs: Date.now() - startTime,
            });
          }

          resolve({
            available: false,
            executable: false,
            failureReason: psErr.message.includes("permission denied")
              ? "Docker daemon permission denied"
              : `Docker runtime check failed: ${psErr.message}`,
            durationMs: Date.now() - startTime,
          });
        });
      });
    });
  }
}

module.exports = DockerProbe;
