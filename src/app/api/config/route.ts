import {
  ConfigValidationError,
  getConfig,
  validateOpeners,
} from "@/lib/config";

export async function GET() {
  const { openers } = getConfig();
  try {
    validateOpeners(openers);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      return Response.json(
        { error: `Invalid openers config: ${err.message}` },
        { status: 500 },
      );
    }
    throw err;
  }
  return Response.json({ openers });
}
