"use client";

import { useControlSocket } from "@/lib/use-control-socket";
import styles from "../preview.module.css";
import { ImageViewer } from "./ImageViewer";
import { PreviewSplash } from "./PreviewSplash";

export function PreviewWall() {
  const { state } = useControlSocket();
  const activePdfId = state?.activePdfId ?? null;
  const activeDocument = activePdfId ? state?.documents[activePdfId] : null;

  return (
    <main className={styles.wall}>
      {activePdfId && activeDocument && activeDocument.images.length > 0 ? (
        <ImageViewer
          images={activeDocument.images}
          pageNumber={activeDocument.page}
          label={activePdfId}
        />
      ) : (
        <PreviewSplash />
      )}
    </main>
  );
}
