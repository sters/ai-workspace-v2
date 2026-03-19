import { NextResponse } from "next/server";
import type z from "zod";
import { getConfig } from "./config";

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("; ");
    return {
      success: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }
  return { success: true, data: result.data };
}

type InteractionLevel = "low" | "mid" | "high";

/**
 * Fill in the config-based default for `interactionLevel` when the client
 * did not provide one.  Call this after `parseBody` in routes whose schema
 * includes an optional `interactionLevel` field.
 */
export function applyOperationDefaults<T extends { interactionLevel?: InteractionLevel }>(
  data: T,
): Omit<T, "interactionLevel"> & { interactionLevel: InteractionLevel } {
  return {
    ...data,
    interactionLevel: data.interactionLevel ?? getConfig().operations.defaultInteractionLevel,
  };
}
