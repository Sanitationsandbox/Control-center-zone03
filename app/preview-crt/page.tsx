"use client";

import { useControlSocket } from "@/lib/use-control-socket";
import { ImageViewer } from "../preview/components/ImageViewer";
import { PreviewSplash } from "../preview/components/PreviewSplash";
import styles from "../preview/preview.module.css";

export default function PreviewCRTPage() {
  const { state } = useControlSocket();
  const document = state?.documents["pdf-1"];

  return (
    <main className={styles.wall}>
      {document && document.images.length > 0 ? (
        <ImageViewer
          images={document.images}
          pageNumber={document.page}
          label="pdf-1"
        />
      ) : (
        <PreviewSplash />
      )}
    </main>
  );
}
