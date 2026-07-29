import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AssetKind, PipelineKey } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

function parsePipelineKey(value: string): PipelineKey | null {
  const upper = value.toUpperCase();
  return (Object.values(PipelineKey) as string[]).includes(upper) ? (upper as PipelineKey) : null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key: rawKey } = await params;
    const key = parsePipelineKey(rawKey);
    if (!key) {
      return NextResponse.json({ error: "Invalid pipeline key" }, { status: 400 });
    }

    const { assetIds } = (await request.json()) as { assetIds?: unknown };
    if (!Array.isArray(assetIds) || !assetIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "assetIds must be an array of strings" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findUnique({
      where: { key },
      include: { activeSlide: true },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    if (assetIds.length > 0) {
      const assets = await prisma.asset.findMany({
        where: { id: { in: assetIds }, kind: AssetKind.IMAGE },
      });
      if (assets.length !== new Set(assetIds).size) {
        return NextResponse.json(
          { error: "One or more assets do not exist or are not images" },
          { status: 400 }
        );
      }
    }

    const clampedPage = Math.min(pipeline.pdfPage, Math.max(1, assetIds.length));
    // Delete+recreate gives every slide a new id, which would silently drop the active
    // selection on every reorder — remember the active asset so it can be re-pointed after.
    const previousActiveAssetId = pipeline.activeSlide?.assetId ?? null;

    await prisma.$transaction(async (tx) => {
      await tx.slide.deleteMany({ where: { pipelineId: pipeline.id } });
      await tx.slide.createMany({
        data: assetIds.map((assetId, position) => ({
          pipelineId: pipeline.id,
          assetId,
          position,
        })),
      });

      const restoredActiveSlide =
        previousActiveAssetId && assetIds.includes(previousActiveAssetId)
          ? await tx.slide.findUniqueOrThrow({
              where: { pipelineId_assetId: { pipelineId: pipeline.id, assetId: previousActiveAssetId } },
            })
          : null;

      await tx.pipeline.update({
        where: { id: pipeline.id },
        data: { pdfPage: clampedPage, activeSlideId: restoredActiveSlide?.id ?? null },
      });
    });

    const refreshed = await prisma.pipeline.findUniqueOrThrow({
      where: { id: pipeline.id },
      include: { slides: { include: { asset: true }, orderBy: { position: "asc" } } },
    });

    return NextResponse.json(refreshed);
  } catch (error) {
    console.error("PUT pipeline slides error:", error);
    return NextResponse.json({ error: "Failed to update pipeline slides" }, { status: 500 });
  }
}
