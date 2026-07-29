import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { uploadToCloudinary, uploadBufferToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";
import { AssetKind } from "@/lib/generated/prisma/enums";

export const dynamic = "force-dynamic";

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

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
    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const createdAssets = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

      const existing = await prisma.asset.findUnique({ where: { checksum } });
      if (existing) {
        createdAssets.push(existing);
        continue;
      }

      const mimeType = file.type || "application/octet-stream";
      const kind = kindFromMime(mimeType);
      const uploadOptions = { folder: "control-center", resource_type: "auto" as const };

      const result =
        buffer.length > LARGE_FILE_THRESHOLD
          ? await uploadBufferToCloudinary(buffer, uploadOptions)
          : await uploadToCloudinary(`data:${mimeType};base64,${buffer.toString("base64")}`, uploadOptions);

      const asset = await prisma.asset.create({
        data: {
          name: file.name,
          filename: result.public_id,
          url: result.secure_url,
          mimeType,
          kind,
          size: result.bytes ?? file.size,
          width: result.width ?? null,
          height: result.height ?? null,
          pageCount: kind === AssetKind.PDF ? result.pages ?? null : null,
          storage: "CLOUDINARY",
          publicId: result.public_id,
          checksum,
        },
      });

      createdAssets.push(asset);
    }

    return NextResponse.json({ success: true, assets: createdAssets });
  } catch (error) {
    console.error("POST upload error:", error);
    return NextResponse.json({ error: "Failed to upload files" }, { status: 500 });
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
