export const mediaDocuments = [
  {
    id: "pdf-1",
    kind: "images",
    images: [
      "/CRT/26.jpg",
      "/CRT/27.jpg",
      "/CRT/28.jpg",
      "/CRT/29.jpg",
    ],
  },
  {
    id: "pdf-2",
    kind: "images",
    images: [
      "/MTU/30.jpg",
      "/MTU/31.jpg",
      "/MTU/32.jpg",
      "/MTU/33.jpg",
    ],
  },
  {
    id: "pdf-3",
    kind: "images",
    images: [
      "/STP/34.jpg",
      "/STP/35.jpg",
      "/STP/36.jpg",
      "/STP/37.jpg",
      "/STP/38.jpg",
      "/STP/39.jpg",
    ],
  },
] as const;

export type PdfId = (typeof mediaDocuments)[number]["id"];
export type PdfDirection = "previous" | "next";

export type PdfPageState = {
  page: number;
  totalPages: number | null;
  updatedAt: number;
  images: string[];
};

export type PdfControlState = Record<PdfId, PdfPageState>;

export type PdfRemoteState = {
  version: number;
  activePdfId: PdfId | null;
  videoPlaying: boolean;
  documents: PdfControlState;
};

export function isPdfId(value: unknown): value is PdfId {
  return mediaDocuments.some((document) => document.id === value);
}

export function isPdfDirection(value: unknown): value is PdfDirection {
  return value === "previous" || value === "next";
}
