-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'PDF', 'VIDEO', 'OTHER');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'STATIC', 'CLOUDINARY');

-- CreateEnum
CREATE TYPE "PipelineKey" AS ENUM ('CRT', 'MTU', 'STP');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "pageCount" INTEGER,
    "storage" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "publicId" TEXT,
    "checksum" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL,
    "key" "PipelineKey" NOT NULL,
    "legacyPdfId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "activeSlideId" TEXT,
    "pdfPage" INTEGER NOT NULL DEFAULT 1,
    "videoPlaying" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Slide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_filename_key" ON "Asset"("filename");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_checksum_key" ON "Asset"("checksum");

-- CreateIndex
CREATE INDEX "Asset_kind_idx" ON "Asset"("kind");

-- CreateIndex
CREATE INDEX "Asset_uploadedAt_idx" ON "Asset"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_key_key" ON "Pipeline"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_legacyPdfId_key" ON "Pipeline"("legacyPdfId");

-- CreateIndex
CREATE UNIQUE INDEX "Pipeline_activeSlideId_key" ON "Pipeline"("activeSlideId");

-- CreateIndex
CREATE INDEX "Slide_pipelineId_position_idx" ON "Slide"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Slide_pipelineId_assetId_key" ON "Slide"("pipelineId", "assetId");

-- AddForeignKey
ALTER TABLE "Pipeline" ADD CONSTRAINT "Pipeline_activeSlideId_fkey" FOREIGN KEY ("activeSlideId") REFERENCES "Slide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slide" ADD CONSTRAINT "Slide_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
