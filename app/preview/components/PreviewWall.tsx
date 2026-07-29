"use client";

import { useCallback, useEffect, useState } from "react";
import { mediaDocuments, type PdfRemoteState, type PdfId } from "@/lib/pdf-control";
import styles from "../preview.module.css";
import { ImageViewer } from "./ImageViewer";

const pdfIds = mediaDocuments.map((document) => document.id);

const initialPages = Object.fromEntries(
  pdfIds.map((id) => [id, 1]),
) as Record<PdfId, number>;

const initialImages = Object.fromEntries(
  pdfIds.map((id) => [id, [] as string[]]),
) as Record<PdfId, string[]>;

export function PreviewWall() {
  const [pages, setPages] = useState(initialPages);
  const [images, setImages] = useState(initialImages);
  const [activePdfId, setActivePdfId] = useState<PdfId | null>(null);

  const refreshPages = useCallback(async () => {
    try {
      const response = await fetch("/api/pdf-control", { cache: "no-store" });
      if (!response.ok) throw new Error("State request failed");

      const data = (await response.json()) as PdfRemoteState;
      setActivePdfId(data.activePdfId);
      setPages(
        Object.fromEntries(
          pdfIds.map((id) => [id, data.documents[id].page]),
        ) as Record<PdfId, number>,
      );
      setImages(
        Object.fromEntries(
          pdfIds.map((id) => [id, data.documents[id].images]),
        ) as Record<PdfId, string[]>,
      );
    } catch {
      // Ignore API offline errors silently
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void refreshPages(), 0);
    const timer = window.setInterval(() => void refreshPages(), 700);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refreshPages]);

  const activeImages = activePdfId ? images[activePdfId] : [];

  return (
    <main className={styles.wall}>
      {activePdfId && activeImages.length > 0 ? (
        <ImageViewer
          images={activeImages}
          pageNumber={pages[activePdfId]}
          label={activePdfId}
        />
      ) : (
        <PreviewSplash />
      )}
    </main>
  );
}

function PreviewSplash() {
  return (
    <section className={styles.splash} aria-label="Rubenius idle screen">
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
      >
        <source src="/BG-VIDEO/Gates%20zone%201.0%20updated.mp4" type="video/mp4" />
      </video>
    </section>
  );
}
