import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PipelineKey } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

function parsePipelineKey(value: string): PipelineKey | null {
  const upper = value.toUpperCase();
  return (Object.values(PipelineKey) as string[]).includes(upper) ? (upper as PipelineKey) : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key: rawKey } = await params;
    const key = parsePipelineKey(rawKey);
    if (!key) {
      return NextResponse.json({ error: "Invalid pipeline key" }, { status: 400 });
    }

    const { assetId } = (await request.json()) as { assetId?: string | null };

    const pipeline = await prisma.pipeline.findUnique({
      where: { key },
      include: { slides: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    if (assetId === null || assetId === undefined) {
      const updated = await prisma.pipeline.update({
        where: { id: pipeline.id },
        data: { activeSlideId: null, pdfPage: 1 },
      });
      return NextResponse.json(updated);
    }

    let slide = pipeline.slides.find((s) => s.assetId === assetId);
    if (!slide) {
      const asset = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!asset || asset.kind !== "IMAGE") {
        return NextResponse.json({ error: "Asset not found or not an image" }, { status: 400 });
      }
      slide = await prisma.slide.create({
        data: { pipelineId: pipeline.id, assetId, position: pipeline.slides.length },
      });
    }

    const updated = await prisma.pipeline.update({
      where: { id: pipeline.id },
      data: { activeSlideId: slide.id, pdfPage: 1 },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("POST pipeline active error:", error);
    return NextResponse.json({ error: "Failed to set active slide" }, { status: 500 });
  }
}
