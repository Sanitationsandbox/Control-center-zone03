import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  isPdfDirection,
  isPdfId,
  mediaDocuments,
  type PdfControlState,
  type PdfId,
  type PdfRemoteState,
} from "@/lib/pdf-control";

type Db = Prisma.TransactionClient;

export type ControlCommand =
  | { action: "clear" }
  | { action: "activate"; pdfId: PdfId }
  | { action: "navigate"; pdfId: PdfId; direction: "previous" | "next" };

type RawControlCommand = {
  action?: unknown;
  pdfId?: unknown;
  direction?: unknown;
};

export function parseControlCommand(body: RawControlCommand | null): ControlCommand | null {
  if (!body) return null;

  if (body.action === "clear") {
    return { action: "clear" };
  }

  if (body.action === "activate" && isPdfId(body.pdfId)) {
    return { action: "activate", pdfId: body.pdfId };
  }

  if (
    body.action === "navigate" &&
    isPdfId(body.pdfId) &&
    isPdfDirection(body.direction)
  ) {
    return {
      action: "navigate",
      pdfId: body.pdfId,
      direction: body.direction,
    };
  }

  return null;
}

/**
 * Reads the monotonic state version without advancing it. A freshly created
 * sequence reports last_value = START with is_called = false, so the very first
 * nextval() returns that same value — normalise the not-yet-called case to zero
 * so "no command has run yet" is distinguishable from "one command has run".
 */
async function readVersion(db: Db): Promise<number> {
  const [row] = await db.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`
    SELECT last_value, is_called FROM "control_state_version"
  `;
  return Number(row.last_value) - (row.is_called ? 0 : 1);
}

async function advanceVersion(db: Db): Promise<number> {
  const [row] = await db.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('control_state_version')
  `;
  return Number(row.nextval);
}

async function readControlState(db: Db, version: number): Promise<PdfRemoteState> {
  const pipelines = await db.pipeline.findMany({
    include: { slides: { include: { asset: true }, orderBy: { position: "asc" } } },
    orderBy: { position: "asc" },
  });

  const pipelineByPdfId = new Map(
    pipelines.map((pipeline) => [pipeline.legacyPdfId, pipeline]),
  );

  const documents = Object.fromEntries(
    mediaDocuments.map((document) => {
      const pipeline = pipelineByPdfId.get(document.id);
      const images = pipeline?.slides.map((slide) => slide.asset.url) ?? [
        ...document.images,
      ];

      return [
        document.id,
        {
          page: pipeline?.pdfPage ?? 1,
          totalPages: images.length,
          updatedAt: pipeline?.updatedAt.getTime() ?? 0,
          images,
        },
      ];
    }),
  ) as PdfControlState;

  const live = pipelines.find((pipeline) => pipeline.live);

  return {
    version,
    activePdfId: isPdfId(live?.legacyPdfId) ? live.legacyPdfId : null,
    videoPlaying: live?.videoPlaying ?? false,
    documents,
  };
}

export async function loadControlState(): Promise<PdfRemoteState> {
  return prisma.$transaction(async (tx) =>
    readControlState(tx, await readVersion(tx)),
  );
}

/**
 * Writes the command, advances the version and snapshots the result inside a
 * single transaction, so the returned version always describes exactly the state
 * that ships with it.
 */
export async function applyControlCommand(
  command: ControlCommand,
): Promise<PdfRemoteState> {
  return prisma.$transaction(async (tx) => {
    if (command.action === "clear") {
      await tx.pipeline.updateMany({ data: { live: false, videoPlaying: false } });
      return readControlState(tx, await advanceVersion(tx));
    }

    if (command.action === "activate") {
      await tx.pipeline.updateMany({ data: { live: false } });
      await tx.pipeline.update({
        where: { legacyPdfId: command.pdfId },
        data: { live: true, videoPlaying: false },
      });
      return readControlState(tx, await advanceVersion(tx));
    }

    const pipeline = await tx.pipeline.findUniqueOrThrow({
      where: { legacyPdfId: command.pdfId },
      include: { _count: { select: { slides: true } } },
    });

    const lastPage = pipeline._count.slides || 1;
    const nextPage =
      command.direction === "next" ? pipeline.pdfPage + 1 : pipeline.pdfPage - 1;
    const page = Math.min(lastPage, Math.max(1, nextPage));

    // Already clamped to this page — don't write, don't bump the version, don't
    // wake every wall up for nothing.
    if (page === pipeline.pdfPage) {
      return readControlState(tx, await readVersion(tx));
    }

    await tx.pipeline.update({
      where: { legacyPdfId: command.pdfId },
      data: { pdfPage: page },
    });

    return readControlState(tx, await advanceVersion(tx));
  });
}
