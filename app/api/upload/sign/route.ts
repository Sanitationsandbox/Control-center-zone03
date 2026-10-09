import { NextResponse } from "next/server";
import { assertCloudinaryConfig, cloudinary } from "@/lib/cloudinary";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertCloudinaryConfig();
    const body = await request.json().catch(() => ({}));
    const folder = body.folder || "control-center";
    const timestamp = Math.round(Date.now() / 1000);

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET!,
    );

    return NextResponse.json({
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_NAME,
      folder,
    });
  } catch (error) {
    console.error("Sign upload error:", error);
    return NextResponse.json({ error: "Failed to generate signature" }, { status: 500 });
  }
}
