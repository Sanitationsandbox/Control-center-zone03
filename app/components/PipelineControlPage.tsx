"use client";

import { useEffect, useMemo, useState } from "react";
import {
  broadcastLocalControlState,
  useControlSocket,
} from "@/lib/use-control-socket";
import type { PdfDirection, PdfId, PdfRemoteState } from "@/lib/pdf-control";

type PipelineControlPageProps = {
  pdfId: PdfId;
  title: string;
  subtitle: string;
};

function pageFor(state: PdfRemoteState | null, pdfId: PdfId) {
  return state?.documents[pdfId]?.page ?? 1;
}

function totalFor(state: PdfRemoteState | null, pdfId: PdfId) {
  return state?.documents[pdfId]?.totalPages ?? null;
}

function withPage(
  state: PdfRemoteState,
  pdfId: PdfId,
  page: number,
  version: number,
): PdfRemoteState {
  return {
    ...state,
    version,
    activePdfId: pdfId,
    documents: {
      ...state.documents,
      [pdfId]: {
        ...state.documents[pdfId],
        page,
        updatedAt: Date.now(),
      },
    },
  };
}

export function PipelineControlPage({
  pdfId,
  title,
  subtitle,
}: PipelineControlPageProps) {
  const { state, status } = useControlSocket();
  const [isSending, setIsSending] = useState(false);
  const [optimisticPage, setOptimisticPage] = useState<{
    page: number;
    version: number;
  } | null>(null);

  const remotePage = pageFor(state, pdfId);
  const totalPages = totalFor(state, pdfId);
  const stateVersion = state?.version ?? 0;
  const currentPage =
    optimisticPage && optimisticPage.version >= stateVersion
      ? optimisticPage.page
      : remotePage;
  const isActive = state?.activePdfId === pdfId;

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Connected";
    if (status === "connecting") return "Connecting";
    return "Reconnecting";
  }, [status]);

  useEffect(() => {
    async function activateModule() {
      try {
        const response = await fetch("/api/pdf-control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "activate", pdfId }),
        });
        if (!response.ok) throw new Error("Activate failed");
      } catch {
        // The socket/dev fallback will keep trying to recover visible state.
      }
    }

    void activateModule();
  }, [pdfId]);

  async function sendCommand(direction: PdfDirection) {
    if (isSending) return;

    const previousPage = currentPage;
    const requestedPage =
      direction === "next" ? previousPage + 1 : previousPage - 1;
    const nextPage = totalPages
      ? Math.min(totalPages, Math.max(1, requestedPage))
      : Math.max(1, requestedPage);

    setIsSending(true);
    setOptimisticPage({ page: nextPage, version: stateVersion });
    if (state) {
      broadcastLocalControlState(
        withPage(state, pdfId, nextPage, stateVersion + 1),
      );
    }

    try {
      const response = await fetch("/api/pdf-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "navigate",
          pdfId,
          direction,
        }),
      });
      if (!response.ok) throw new Error("Command failed");

      const nextState = (await response.json()) as PdfRemoteState;
      broadcastLocalControlState(nextState);
      setOptimisticPage({
        page: pageFor(nextState, pdfId),
        version: nextState.version,
      });
    } catch {
      setOptimisticPage({ page: previousPage, version: stateVersion });
      if (state) {
        broadcastLocalControlState(
          withPage(state, pdfId, previousPage, stateVersion + 1),
        );
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full flex flex-col items-center justify-center bg-[#030712] overflow-hidden text-slate-100 font-sans select-none">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at center, rgba(16, 185, 129, 0.08) 0%, rgba(3, 7, 18, 0) 70%)",
        }}
      />

      <div className="absolute top-6 left-6 z-10">
        <a
          href="https://gates.framer.website/zone-2/zone-2-main#section2"
          className="text-xs font-mono tracking-widest text-slate-500 hover:text-teal-400 transition-colors uppercase"
        >
          &larr; BACK
        </a>
      </div>

      <div className="absolute top-6 right-6 z-10 flex items-center gap-2 rounded-full border border-teal-500/20 bg-slate-950/50 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-400">
        <span
          className={`h-2 w-2 rounded-full ${
            status === "connected" ? "bg-teal-400" : "bg-amber-400"
          }`}
          aria-hidden="true"
        />
        {statusLabel}
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-4xl px-6 text-center space-y-6">
        <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-[0.25em] text-[#a7f3d0] leading-tight select-none">
          {title}
        </h1>

        <p className="text-xs md:text-sm text-slate-400 font-light tracking-wide max-w-lg">
          {subtitle}
        </p>

        <div className="flex items-center gap-3 text-[11px] font-mono uppercase tracking-widest text-slate-500">
          <span>{isActive ? "Live" : "Activating"}</span>
          <span aria-hidden="true">/</span>
          <span>
            Slide {currentPage}
            {totalPages ? ` of ${totalPages}` : ""}
          </span>
        </div>

        <div className="flex gap-6 pt-4">
          <button
            type="button"
            aria-label="Previous slide"
            disabled={isSending || currentPage <= 1}
            onClick={() => void sendCommand("previous")}
            className="w-14 h-14 md:w-16 md:h-16 flex items-center justify-center rounded-full border border-teal-500/30 hover:border-teal-400 text-teal-400 hover:bg-teal-500/10 cursor-pointer transition-all duration-200 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="w-5 h-5 md:w-6 md:h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <button
            type="button"
            aria-label="Next slide"
            disabled={isSending || (totalPages !== null && currentPage >= totalPages)}
            onClick={() => void sendCommand("next")}
            className="w-14 h-14 md:w-16 md:h-16 flex items-center justify-center rounded-full border border-teal-500/30 hover:border-teal-400 text-teal-400 hover:bg-teal-500/10 cursor-pointer transition-all duration-200 active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="w-5 h-5 md:w-6 md:h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
