import { checkForUpdate } from "@/lib/update";

export async function GET() {
  const currentHash = process.env.AIW_GIT_HASH || "";

  if (!currentHash) {
    return Response.json({
      currentHash: "",
      latestHash: null,
      updateAvailable: false,
      devMode: true,
    });
  }

  try {
    const result = await checkForUpdate(currentHash);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
