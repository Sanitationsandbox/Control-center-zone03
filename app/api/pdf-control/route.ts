import { prisma } from "@/lib/prisma";
import { isPdfDirection, isPdfId, type PdfId } from "@/lib/pdf-control";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function loadState() {
  const pipelines = await prisma.pipeline.findMany({
    include: { slides: { include: { asset: true }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });

  const documents = Object.fromEntries(
    pipelines.map((pipeline) => [
      pipeline.legacyPdfId,
      {
        page: pipeline.pdfPage,
        totalPages: pipeline.slides.length,
        updatedAt: pipeline.updatedAt.getTime(),
        images: pipeline.slides.map((slide) => slide.asset.url),
      },
    ])
  );

  const live = pipelines.find((pipeline) => pipeline.live);

  return {
    activePdfId: (live?.legacyPdfId ?? null) as PdfId | null,
    videoPlaying: live?.videoPlaying ?? false,
    documents,
  };
}

export async function GET() {
  return json(await loadState());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    pdfId?: unknown;
    direction?: unknown;
    playback?: unknown;
  } | null;

  if (!body) {
    return json({ error: "Invalid PDF command" }, 400);
  }

  if (body.action === "clear") {
    await prisma.pipeline.updateMany({ data: { live: false, videoPlaying: false } });
    return json(await loadState());
  }

  if (body.action === "activate" && isPdfId(body.pdfId)) {
    await prisma.$transaction([
      prisma.pipeline.updateMany({ data: { live: false } }),
      prisma.pipeline.update({
        where: { legacyPdfId: body.pdfId },
        data: { live: true, videoPlaying: false },
      }),
    ]);
    return json(await loadState());
  }

  if (
    body.action !== "navigate" ||
    !isPdfId(body.pdfId) ||
    !isPdfDirection(body.direction)
  ) {
    return json({ error: "Invalid PDF command" }, 400);
  }

  const pipeline = await prisma.pipeline.findUniqueOrThrow({
    where: { legacyPdfId: body.pdfId },
    include: { _count: { select: { slides: true } } },
  });

  const lastPage = pipeline._count.slides || 1;
  const nextPage =
    body.direction === "next" ? pipeline.pdfPage + 1 : pipeline.pdfPage - 1;
  const page = Math.min(lastPage, Math.max(1, nextPage));

  const updated = await prisma.pipeline.update({
    where: { legacyPdfId: body.pdfId },
    data: { pdfPage: page },
  });

  return json({
    pdfId: body.pdfId,
    document: {
      page: updated.pdfPage,
      totalPages: lastPage,
      updatedAt: updated.updatedAt.getTime(),
    },
  });
}

export async function PATCH() {
  return json(
    { error: "totalPages is now derived from the pipeline's slide count and can no longer be set directly" },
    410
  );
}
