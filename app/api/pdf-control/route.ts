import { publishControlState } from "@/lib/control-pubsub";
import {
  applyControlCommand,
  loadControlState,
  parseControlCommand,
} from "@/lib/control-state";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  return json(await loadControlState());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Parameters<
    typeof parseControlCommand
  >[0];
  const command = parseControlCommand(body);

  if (!command) {
    return json({ error: "Invalid PDF command" }, 400);
  }

  const state = await applyControlCommand(command);
  await publishControlState(state);
  return json(state);
}

export async function PATCH() {
  return json(
    { error: "totalPages is now derived from the pipeline's slide count and can no longer be set directly" },
    410
  );
}
