import { spawnClaudeAuth, checkAuthStatus } from "@/lib/claude/login";
import type { PipelinePhaseFunction } from "@/types/pipeline";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array()),
  );
}

export function buildClaudeLoginPhase(): PipelinePhaseFunction {
  return {
    kind: "function",
    label: "Claude Login",
    fn: async (ctx) => {
      // Step 1: Check current status
      ctx.emitStatus("Checking current auth status...");
      try {
        const status = await checkAuthStatus();
        ctx.emitStatus(`Current status: ${status}`);
      } catch (err) {
        ctx.emitStatus(`Auth status check failed: ${err}`);
      }

      // Step 2: Run claude auth login
      ctx.emitStatus("Running claude auth login...");

      const proc = spawnClaudeAuth("login");

      const aborted = new Promise<"aborted">((resolve) => {
        ctx.signal.addEventListener(
          "abort",
          () => {
            ctx.emitStatus("Operation cancelled");
            proc.kill();
            resolve("aborted");
          },
          { once: true },
        );
      });

      const completed = Promise.all([
        readStream(proc.stdout),
        readStream(proc.stderr),
        proc.exited,
      ]);

      const result = await Promise.race([completed, aborted]);

      if (result === "aborted") {
        return false;
      }

      const [stdout, stderr, exitCode] = result;

      if (exitCode !== 0) {
        ctx.emitStatus(`Login failed: ${stderr.trim() || `Exit code ${exitCode}`}`);
        return false;
      }

      const output = stdout.trim();
      if (output) ctx.emitStatus(output);
      ctx.emitStatus("Login completed successfully!");
      return true;
    },
  };
}
