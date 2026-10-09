import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFromCloudinary } from "@/lib/cloudinary";
import { AssetKind } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

function kindFromMime(mime: string): AssetKind {
  if (mime.startsWith("image/")) return AssetKind.IMAGE;
  if (mime === "application/pdf") return AssetKind.PDF;
  if (mime.startsWith("video/")) return AssetKind.VIDEO;
  return AssetKind.OTHER;
}

function resourceTypeFor(kind: AssetKind): "image" | "video" | "raw" {
  if (kind === AssetKind.VIDEO) return "video";
  if (kind === AssetKind.PDF) return "raw";
  return "image";
}

export async function GET() {
  try {
    const assets = await prisma.asset.findMany({ orderBy: { uploadedAt: "desc" } });
    return NextResponse.json(assets);
  } catch (error) {
    console.error("GET assets error:", error);
    return NextResponse.json({ error: "Failed to load assets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      name,
      url,
      mimeType,
      size,
      width,
      height,
      pageCount,
      publicId,
      checksum,
    } = body as {
      name?: string;
      url?: string;
      mimeType?: string;
      size?: number;
      width?: number | null;
      height?: number | null;
      pageCount?: number | null;
      publicId?: string;
      checksum?: string;
    };

    if (!name || !url || !mimeType || typeof size !== "number" || !publicId || !checksum) {
      return NextResponse.json({ error: "Missing required asset metadata" }, { status: 400 });
    }

    const existing = await prisma.asset.findUnique({ where: { checksum } });
    if (existing) {
      return NextResponse.json({ success: true, asset: existing, duplicate: true });
    }

    const kind = kindFromMime(mimeType);
    const asset = await prisma.asset.create({
      data: {
        name,
        filename: publicId,
        url,
        mimeType,
        kind,
        size,
        width: width ?? null,
        height: height ?? null,
        pageCount: kind === AssetKind.PDF ? pageCount ?? null : null,
        storage: "CLOUDINARY",
        publicId,
        checksum,
      },
    });

    return NextResponse.json({ success: true, asset });
  } catch (error) {
    console.error("POST upload error:", error);
    return NextResponse.json({ error: "Failed to register uploaded file" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = (await request.json()) as { id?: string };
    if (!id) {
      return NextResponse.json({ error: "Missing asset ID" }, { status: 400 });
    }

    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    if (asset.storage === "CLOUDINARY" && asset.publicId) {
      try {
        await deleteFromCloudinary(asset.publicId, { resource_type: resourceTypeFor(asset.kind) });
      } catch (err) {
        console.warn(`Cloudinary destroy failed for ${asset.publicId}`, err);
      }
    }

    await prisma.asset.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE asset error:", error);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
