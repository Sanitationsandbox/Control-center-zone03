"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PdfRemoteState } from "@/lib/pdf-control";

type LoadStatus = "loading" | "loaded" | "offline";

export function HomeStatus() {
  const [systemState, setSystemState] = useState<PdfRemoteState | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const response = await fetch("/api/pdf-control", { cache: "no-store" });
        if (!response.ok) throw new Error("State request failed");
        const state = (await response.json()) as PdfRemoteState;
        if (cancelled) return;
        setSystemState(state);
        setLoadStatus("loaded");
      } catch {
        if (!cancelled) setLoadStatus("offline");
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, []);

  const isLoaded = loadStatus === "loaded";

  return (
    <div className="w-full max-w-6xl mx-auto space-y-12">
      {/* System Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-6 bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3.5 w-3.5">
            <span
              className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                isLoaded ? "bg-emerald-500" : "bg-rose-500"
              }`}
            />
          </span>
          <div>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">System Status</p>
            <p className="text-sm font-semibold text-white">
              {loadStatus === "loading"
                ? "LOADING STATE"
                : isLoaded
                  ? "STATE LOADED"
                  : "STATE UNAVAILABLE"}
            </p>
          </div>
        </div>

        <div className="flex gap-8">
          <div>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">Realtime Status</p>
            <p className="text-sm font-semibold font-mono text-cyan-400">
              Controller screens only
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 font-mono uppercase tracking-wider">Active Projection</p>
            <p className="text-sm font-semibold text-teal-400 font-mono">
              {systemState?.activePdfId === "pdf-1" && "CRT ACTIVE"}
              {systemState?.activePdfId === "pdf-2" && "MTU ACTIVE"}
              {systemState?.activePdfId === "pdf-3" && "STP ACTIVE"}
              {!systemState?.activePdfId && "Idle Video Loop"}
            </p>
          </div>
        </div>
      </div>

      {/* Main Portals Grid - 3 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Card 1: CRT (Amber Theme) */}
        <div className="group relative flex flex-col justify-between overflow-hidden p-8 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 hover:border-amber-500/50 hover:shadow-[0_0_40px_rgba(245,158,11,0.15)] transition-all duration-300 transform hover:-translate-y-1.5">
          <div className="absolute -right-16 -top-16 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-all duration-300" />
          
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center group-hover:scale-110 group-hover:border-amber-400 transition-all duration-300">
                {/* Flame/Combustor Icon */}
                <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              
              {systemState?.activePdfId === "pdf-1" && (
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 animate-pulse">
                  ACTIVE
                </span>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-xl font-bold tracking-tight text-white group-hover:text-amber-300 transition-colors">
                CRT Console
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Community Reinvented Toilet. Lasting Impact. Deploy waste treatment schematics and community sanitation layouts.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-mono text-slate-500">
                <span>Slide page:</span>
                <span className="text-slate-300 font-semibold">
                  {systemState ? `${systemState.documents["pdf-1"].page} / ${systemState.documents["pdf-1"].totalPages ?? "?"}` : "--"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href="/control-center-crt"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-[#070b14] bg-amber-500 hover:bg-amber-400 rounded-xl transition-all duration-200 shadow-md active:scale-98"
            >
              OPEN CONTROLLER
            </Link>
            <Link
              href="/preview-crt"
              target="_blank"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-slate-300 border border-white/10 hover:border-amber-500/40 hover:text-white rounded-xl bg-slate-950/20 hover:bg-slate-950/40 transition-all duration-200 active:scale-98"
            >
              LAUNCH DISPLAY &rarr;
            </Link>
          </div>
        </div>

        {/* Card 2: MTU (Cyan Theme) */}
        <div className="group relative flex flex-col justify-between overflow-hidden p-8 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 hover:border-cyan-500/50 hover:shadow-[0_0_40px_rgba(6,182,212,0.15)] transition-all duration-300 transform hover:-translate-y-1.5">
          <div className="absolute -right-16 -top-16 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all duration-300" />
          
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center group-hover:scale-110 group-hover:border-cyan-400 transition-all duration-300">
                {/* Truck/Chassis Icon */}
                <svg className="w-7 h-7 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              
              {systemState?.activePdfId === "pdf-2" && (
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 animate-pulse">
                  ACTIVE
                </span>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-xl font-bold tracking-tight text-white group-hover:text-cyan-300 transition-colors">
                MTU Console
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Mobile Treatment Unit. Portable Treatment. Lasting Impact. Manage mobile filtration rigs and trailer energy system configurations.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-mono text-slate-500">
                <span>Slide page:</span>
                <span className="text-slate-300 font-semibold">
                  {systemState ? `${systemState.documents["pdf-2"].page} / ${systemState.documents["pdf-2"].totalPages ?? "?"}` : "--"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href="/control-center-mtu"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-[#070b14] bg-cyan-500 hover:bg-cyan-400 rounded-xl transition-all duration-200 shadow-md active:scale-98"
            >
              OPEN CONTROLLER
            </Link>
            <Link
              href="/preview-mtu"
              target="_blank"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-slate-300 border border-white/10 hover:border-cyan-500/40 hover:text-white rounded-xl bg-slate-950/20 hover:bg-slate-950/40 transition-all duration-200 active:scale-98"
            >
              LAUNCH DISPLAY &rarr;
            </Link>
          </div>
        </div>

        {/* Card 3: STP (Emerald Theme) */}
        <div className="group relative flex flex-col justify-between overflow-hidden p-8 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 hover:border-emerald-500/50 hover:shadow-[0_0_40px_rgba(16,185,129,0.15)] transition-all duration-300 transform hover:-translate-y-1.5">
          <div className="absolute -right-16 -top-16 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all duration-300" />
          
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:scale-110 group-hover:border-emerald-400 transition-all duration-300">
                {/* Recycling/Eco Icon */}
                <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3 3L22 4" />
                </svg>
              </div>
              
              {systemState?.activePdfId === "pdf-3" && (
                <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 animate-pulse">
                  ACTIVE
                </span>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-xl font-bold tracking-tight text-white group-hover:text-emerald-300 transition-colors">
                STP Console
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed font-light">
                Packaged Treatment Plant. Packaged Treatment. Lasting Impact. Visualise sludge management biological reactors and effluent clarifier systems.
              </p>
              <div className="pt-2 flex items-center gap-2 text-xs font-mono text-slate-500">
                <span>Slide page:</span>
                <span className="text-slate-300 font-semibold">
                  {systemState ? `${systemState.documents["pdf-3"].page} / ${systemState.documents["pdf-3"].totalPages ?? "?"}` : "--"}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href="/control-center-stp"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-[#070b14] bg-emerald-500 hover:bg-emerald-400 rounded-xl transition-all duration-200 shadow-md active:scale-98"
            >
              OPEN CONTROLLER
            </Link>
            <Link
              href="/preview-stp"
              target="_blank"
              className="w-full flex items-center justify-center py-3 text-xs font-mono font-bold tracking-widest text-slate-300 border border-white/10 hover:border-emerald-500/40 hover:text-white rounded-xl bg-slate-950/20 hover:bg-slate-950/40 transition-all duration-200 active:scale-98"
            >
              LAUNCH DISPLAY &rarr;
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
