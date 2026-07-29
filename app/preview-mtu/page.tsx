"use client";

import { useEffect, useState } from "react";
import { type PdfRemoteState } from "@/lib/pdf-control";
import { ImageViewer } from "../preview/components/ImageViewer";
import styles from "../preview/preview.module.css";

export default function PreviewMtuPage() {
  const [page, setPage] = useState(1);
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    async function syncState() {
      try {
        const response = await fetch("/api/pdf-control", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as PdfRemoteState;
          setPage(data.documents["pdf-2"].page);
          setImages(data.documents["pdf-2"].images);
        }
      } catch {
        // Ignore API offline errors silently
      }
    }

    const initialTimer = window.setTimeout(() => void syncState(), 0);
    const timer = window.setInterval(() => void syncState(), 700);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className={styles.wall}>
      {images.length > 0 && (
        <ImageViewer images={images} pageNumber={page} label="pdf-2" />
      )}
    </main>
  );
}
