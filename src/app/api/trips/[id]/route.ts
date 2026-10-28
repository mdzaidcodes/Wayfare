import { StoredTrip } from "@/lib/schemas/storage";
import { withDb } from "@/server/db/routes";
import { deleteTrip, saveTrip } from "@/server/db/trips";
import { parseBody } from "@/server/http/route-helpers";

/** Saves the whole trip (it replaces what was saved before). */
export async function PUT(request: Request, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  const body = await parseBody(request, StoredTrip, 10_000_000);
  if (body instanceof Response) return body;
  const rows = [...body.options, body.selections, body.itinerary, body.checklist].filter((r) => r !== undefined);
  if (body.trip.id !== id || rows.some((r) => r.tripId !== id)) {
    return Response.json({ code: "bad_request", message: "The trip ID in the body doesn't match the URL.", nextStep: "Reload the page and try again." }, { status: 400 });
  }
  return withDb(async (pool) => {
    await saveTrip(pool, body);
    return new Response(null, { status: 204 });
  });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/trips/[id]">) {
  const { id } = await ctx.params;
  return withDb(async (pool) => {
    await deleteTrip(pool, id);
    return new Response(null, { status: 204 });
  });
}
