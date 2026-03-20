/**
 * Next.js instrumentation hook — runs once when the server starts.
 * Used to initialize the database and resume interrupted operations.
 *
 * The NEXT_RUNTIME check is specifically recognized by Next.js's bundler,
 * so the dynamic import of instrumentation-node is excluded from the
 * Edge Runtime bundle — eliminating "node:fs/path/os in Edge" warnings.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
