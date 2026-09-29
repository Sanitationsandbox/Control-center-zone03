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
  try {
    return json(await loadControlState());
  } catch (error) {
    console.error("Failed to load control state", error);
    return json({ error: "Control state is temporarily unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Parameters<
    typeof parseControlCommand
  >[0];
  const command = parseControlCommand(body);

  if (!command) {
    return json({ error: "Invalid PDF command" }, 400);
  }

  try {
    const state = await applyControlCommand(command);
    await publishControlState(state);
    return json(state);
  } catch (error) {
    console.error("Failed to apply control command", error);
    return json({ error: "Control state is temporarily unavailable" }, 503);
  }
}

export async function PATCH() {
  return json(
    { error: "totalPages is now derived from the pipeline's slide count and can no longer be set directly" },
    410
  );
}
