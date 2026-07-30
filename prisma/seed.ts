import "dotenv/config";
import { prisma } from "../lib/prisma";
import { PipelineKey } from "../lib/generated/prisma/enums";

const PIPELINE_META: Record<PipelineKey, { legacyPdfId: string; title: string; accent: string; position: number }> = {
  [PipelineKey.CRT]: { legacyPdfId: "pdf-1", title: "CRT Pipeline", accent: "amber", position: 0 },
  [PipelineKey.MTU]: { legacyPdfId: "pdf-2", title: "MTU Pipeline", accent: "cyan", position: 1 },
  [PipelineKey.STP]: { legacyPdfId: "pdf-3", title: "STP Pipeline", accent: "emerald", position: 2 },
};

// Only ensures the 3 pipelines exist. Slides are populated exclusively through
// /admin (real Cloudinary uploads) — no local static images are seeded here.
async function main() {
  for (const key of Object.values(PipelineKey)) {
    const meta = PIPELINE_META[key];
    await prisma.pipeline.upsert({
      where: { legacyPdfId: meta.legacyPdfId },
      update: {},
      create: {
        key,
        legacyPdfId: meta.legacyPdfId,
        title: meta.title,
        accent: meta.accent,
        position: meta.position,
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
