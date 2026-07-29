import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pipelines = await prisma.pipeline.findMany({
      include: { slides: { include: { asset: true }, orderBy: { position: "asc" } } },
      orderBy: { position: "asc" },
    });
    return NextResponse.json(pipelines);
  } catch (error) {
    console.error("GET pipelines error:", error);
    return NextResponse.json({ error: "Failed to load pipelines" }, { status: 500 });
  }
}
