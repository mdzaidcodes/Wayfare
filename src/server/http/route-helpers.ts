import "server-only";
import { readJson } from "./sse";
import { toApiError } from "./errors";

/** Parses and validates a JSON body, or returns a 400 response naming what was wrong. */
export async function parseBody<T>(request: Request, schema: { parse: (v: unknown) => T }, maxChars?: number): Promise<T | Response> {
  try {
    return await readJson(request, schema, maxChars);
  } catch (e) {
    const err = toApiError(e);
    return Response.json({ ...err, code: "bad_request" }, { status: 400 });
  }
}
