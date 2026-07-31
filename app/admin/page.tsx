"use client";

import { useState, useEffect, useRef, DragEvent, ChangeEvent } from "react";
import Link from "next/link";

type AssetKind = "IMAGE" | "PDF" | "VIDEO" | "OTHER";
type StorageProvider = "LOCAL" | "STATIC" | "CLOUDINARY";
type PipelineKey = "CRT" | "MTU" | "STP";

interface Asset {
  id: string;
  name: string;
  filename: string;
  url: string;
  mimeType: string;
  kind: AssetKind;
  size: number;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  storage: StorageProvider;
  publicId: string | null;
  checksum: string | null;
  uploadedAt: string;
}

interface PipelineSlide {
  id: string;
  pipelineId: string;
  assetId: string;
  position: number;
  createdAt: string;
  asset: Asset;
}

interface PipelineData {
  id: string;
  key: PipelineKey;
  legacyPdfId: string;
  title: string;
  accent: string;
  position: number;
  activeSlideId: string | null;
  live: boolean;
  pdfPage: number;
  videoPlaying: boolean;
  updatedAt: string;
  slides: PipelineSlide[];
}

interface UploadingFile {
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
}

function activeAssetIdFor(pipeline: PipelineData | undefined): string | null {
  if (!pipeline) return null;
  return pipeline.slides.find((s) => s.id === pipeline.activeSlideId)?.assetId ?? null;
}

export default function AdminPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [pipelines, setPipelines] = useState<PipelineData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Upload modal states
  const [uploadFiles, setUploadFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [crtOpen, setCrtOpen] = useState<boolean>(true);
  const [mtuOpen, setMtuOpen] = useState<boolean>(true);
  const [stpOpen, setStpOpen] = useState<boolean>(true);

  // Drag and drop states for slide reordering
  const [draggedSlide, setDraggedSlide] = useState<{ pipeline: "crt" | "mtu" | "stp"; index: number } | null>(null);
  const [dragOverSlideIndex, setDragOverSlideIndex] = useState<number | null>(null);

  const crtPipeline = pipelines.find((p) => p.key === "CRT");
  const mtuPipeline = pipelines.find((p) => p.key === "MTU");
  const stpPipeline = pipelines.find((p) => p.key === "STP");

  const crtSlides = crtPipeline?.slides ?? [];
  const mtuSlides = mtuPipeline?.slides ?? [];
  const stpSlides = stpPipeline?.slides ?? [];

  const activeCrtAssetId = activeAssetIdFor(crtPipeline);
  const activeMtuAssetId = activeAssetIdFor(mtuPipeline);
  const activeStpAssetId = activeAssetIdFor(stpPipeline);

  const handleTogglePipelineAsset = async (key: PipelineKey, asset: Asset) => {
    const pipeline = pipelines.find((p) => p.key === key);
    const currentActiveAssetId = activeAssetIdFor(pipeline);
    const nextAssetId = currentActiveAssetId === asset.id ? null : asset.id;

    try {
      const res = await fetch(`/api/pipelines/${key.toLowerCase()}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: nextAssetId }),
      });
      if (!res.ok) throw new Error("Failed to update active slide");
      await fetchPipelines();
    } catch {
      showToast("Failed to update pipeline", "error");
    }
  };

  const handleSetActiveSlide = async (key: PipelineKey, assetId: string) => {
    try {
      const res = await fetch(`/api/pipelines/${key.toLowerCase()}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      if (!res.ok) throw new Error("Failed to set active slide");
      await fetchPipelines();
    } catch {
      showToast("Failed to update pipeline", "error");
    }
  };

  const handleSlideDragStart = (pipeline: "crt" | "mtu" | "stp", index: number) => {
    setDraggedSlide({ pipeline, index });
  };

  const handleSlideDragOver = (e: any, index: number) => {
    e.preventDefault();
    setDragOverSlideIndex(index);
  };

  const handleSlideDragEnd = () => {
    setDraggedSlide(null);
    setDragOverSlideIndex(null);
  };

  const handleSlideDrop = async (pipelineKey: "crt" | "mtu" | "stp", targetIndex: number) => {
    if (!draggedSlide || draggedSlide.pipeline !== pipelineKey) return;
    const sourceIndex = draggedSlide.index;
    if (sourceIndex === targetIndex) return;

    const upperKey = pipelineKey.toUpperCase() as PipelineKey;
    const pipeline = pipelines.find((p) => p.key === upperKey);
    if (!pipeline) return;

    const reordered = [...pipeline.slides];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const assetIds = reordered.map((s) => s.assetId);

    // Optimistic reorder so the drag feels instant; the server response reconciles slide ids after.
    setPipelines((prev) =>
      prev.map((p) =>
        p.key === upperKey ? { ...p, slides: reordered.map((s, i) => ({ ...s, position: i })) } : p
      )
    );

    handleSlideDragEnd();

    try {
      const res = await fetch(`/api/pipelines/${pipelineKey}/slides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds }),
      });
      if (!res.ok) throw new Error("Failed to reorder slides");
      await fetchPipelines();
    } catch {
      showToast("Failed to reorder pipeline slides", "error");
      await fetchPipelines();
    }
  };

  const handleRemoveSlide = async (key: PipelineKey, assetId: string) => {
    const pipeline = pipelines.find((p) => p.key === key);
    if (!pipeline) return;

    const remainingAssetIds = pipeline.slides
      .filter((s) => s.assetId !== assetId)
      .map((s) => s.assetId);

    // Optimistically update the UI
    setPipelines((prev) =>
      prev.map((p) =>
        p.key === key
          ? {
              ...p,
              slides: p.slides
                .filter((s) => s.assetId !== assetId)
                .map((s, idx) => ({ ...s, position: idx })),
            }
          : p
      )
    );

    try {
      const res = await fetch(`/api/pipelines/${key.toLowerCase()}/slides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: remainingAssetIds }),
      });
      if (!res.ok) throw new Error("Failed to remove slide");
      await fetchPipelines();
      showToast("Removed slide from pipeline", "success");
    } catch {
      showToast("Failed to remove slide", "error");
      await fetchPipelines();
    }
  };

  // Fetch all uploaded assets
  const fetchAssets = async () => {
    try {
      const res = await fetch("/api/upload");
      if (!res.ok) throw new Error("Failed to load assets");
      const data = (await res.json()) as Asset[];
      setAssets(data);
    } catch (err) {
      showToast("Error loading assets", "error");
    } finally {
      setLoading(false);
    }
  };

  // Fetch all pipelines with their ordered slides
  const fetchPipelines = async () => {
    try {
      const res = await fetch("/api/pipelines");
      if (!res.ok) throw new Error("Failed to load pipelines");
      const data = (await res.json()) as PipelineData[];
      setPipelines(data);
    } catch {
      showToast("Error loading pipelines", "error");
    }
  };

  useEffect(() => {
    void fetchAssets();
    void fetchPipelines();
  }, []);

  // Helper to show toast message
  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Format bytes to readable size
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // Copy URL/path to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied path to clipboard!", "success");
    } catch {
      showToast("Failed to copy path", "error");
    }
  };

  // Delete an asset
  const confirmDelete = async () => {
    if (!assetToDelete) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetToDelete.id }),
      });
      if (!res.ok) throw new Error("Failed to delete asset");
      showToast("Asset deleted successfully", "success");
      setAssetToDelete(null);
      void fetchAssets();
      void fetchPipelines();
    } catch {
      showToast("Failed to delete asset", "error");
    } finally {
      setIsDeleting(false);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
  };

  const addFiles = (files: File[]) => {
    const newUploading: UploadingFile[] = files.map((file) => ({
      file,
      status: "pending",
      progress: 0,
    }));
    setUploadFiles((prev) => [...prev, ...newUploading]);
  };

  const removeUploadFile = (index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Execute Upload
  const handleUploadSubmit = async () => {
    if (uploadFiles.length === 0) return;
    setIsUploading(true);

    const formData = new FormData();
    uploadFiles.forEach((uf) => {
      formData.append("files", uf.file);
    });

    // Mark all as uploading
    setUploadFiles((prev) =>
      prev.map((uf) => ({ ...uf, status: "uploading" }))
    );

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");

      // Mark all as success
      setUploadFiles((prev) =>
        prev.map((uf) => ({ ...uf, status: "success" }))
      );
      showToast(`Successfully uploaded ${uploadFiles.length} file(s)`, "success");

      // Delay closing modal slightly so the user sees the success state
      setTimeout(() => {
        setIsModalOpen(false);
        setUploadFiles([]);
        void fetchAssets();
      }, 800);
    } catch {
      setUploadFiles((prev) =>
        prev.map((uf) => ({ ...uf, status: "error" }))
      );
      showToast("Upload failed. Please try again.", "error");
    } finally {
      setIsUploading(false);
    }
  };

  // Compute stat aggregates
  const totalSize = assets.reduce((acc, curr) => acc + curr.size, 0);
  const imagesCount = assets.filter((a) => a.kind === "IMAGE").length;
  const pdfsCount = assets.filter((a) => a.kind === "PDF").length;
  const otherCount = assets.length - imagesCount - pdfsCount;

  return (
    <main className="relative min-h-screen w-full flex flex-col items-center p-6 md:p-12 lg:p-20 overflow-hidden bg-[#070b14] text-slate-100 font-sans">
      {/* Background radial glow effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-950/20 via-slate-950 to-slate-950 pointer-events-none" />

      {/* Grid Overlay */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"
        style={{ maskImage: "radial-gradient(ellipse at center, black, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 80%)" }}
      />

      {/* Decorative ambient blobs */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-cyan-500/5 blur-[120px] pointer-events-none animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/5 blur-[140px] pointer-events-none animate-pulse-glow" style={{ animationDelay: "1.5s" }} />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl border backdrop-blur-xl shadow-2xl transition-all duration-300 animate-slide-in ${
          toast.type === "success"
            ? "bg-emerald-950/80 border-emerald-500/35 text-emerald-300"
            : "bg-rose-950/80 border-rose-500/35 text-rose-300"
        }`}>
          {toast.type === "success" ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
          <span className="text-sm font-medium tracking-wide">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="relative w-full max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6 z-10 border-b border-white/5 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-cyan-400 font-mono border border-cyan-400/30 px-2 py-0.5 rounded-full bg-cyan-950/30">
              ADMIN PANEL
            </span>
          </div>
          <p className="text-xs text-slate-400 font-light">Asset management pipeline and presentation controllers.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-xs font-mono tracking-widest text-slate-400 hover:text-cyan-400 transition-colors uppercase py-2 px-4 rounded-lg bg-slate-900/40 border border-white/5"
          >
            &larr; BACK TO CONSOLE
          </Link>
        </div>
      </header>

      {/* Main Container */}
      <div className="relative w-full max-w-6xl mx-auto z-10 mt-10 space-y-10">

        {/* Stats Grid */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="p-5 bg-slate-900/30 backdrop-blur-xl border border-white/5 rounded-2xl shadow-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">Total Assets</span>
            <span className="text-3xl font-extrabold font-mono text-cyan-400 mt-2">{assets.length}</span>
          </div>
          <div className="p-5 bg-slate-900/30 backdrop-blur-xl border border-white/5 rounded-2xl shadow-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">Total Size</span>
            <span className="text-3xl font-extrabold font-mono text-teal-400 mt-2">{formatBytes(totalSize)}</span>
          </div>
          <div className="p-5 bg-slate-900/30 backdrop-blur-xl border border-white/5 rounded-2xl shadow-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">Images Count</span>
            <span className="text-3xl font-extrabold font-mono text-amber-500 mt-2">{imagesCount}</span>
          </div>
          <div className="p-5 bg-slate-900/30 backdrop-blur-xl border border-white/5 rounded-2xl shadow-xl flex flex-col justify-between">
            <span className="text-xs text-slate-400 font-mono uppercase tracking-wider">PDFs Count</span>
            <span className="text-3xl font-extrabold font-mono text-purple-400 mt-2">{pdfsCount}</span>
          </div>
        </section>

        {/* Action Header & Upload Trigger */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Repository Assets</h2>
            <p className="text-xs text-slate-400 font-light mt-1">Uploaded files accessible dynamically by CRT, MTU and STP viewports.</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 py-3 px-6 text-xs font-mono font-bold tracking-wider text-[#070b14] bg-cyan-400 hover:bg-cyan-300 rounded-xl transition-all duration-200 shadow-[0_0_20px_rgba(34,211,238,0.2)] hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] active:scale-98 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            UPLOAD ASSETS
          </button>
        </section>

        {/* Table/Assets View */}
        <section className="p-6 bg-slate-900/20 backdrop-blur-xl border border-white/5 rounded-3xl shadow-xl overflow-hidden">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-4 text-slate-400">
              <div className="w-8 h-8 rounded-full border-2 border-cyan-400/20 border-t-cyan-400 animate-spin" />
              <span className="text-xs font-mono tracking-widest">LOADING ASSETS DATABASE...</span>
            </div>
          ) : assets.length === 0 ? (
            <div className="py-24 flex flex-col items-center justify-center gap-6 border border-dashed border-white/5 rounded-2xl bg-slate-950/10">
              <div className="w-16 h-16 rounded-full bg-slate-900 border border-white/10 flex items-center justify-center text-slate-500">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
                </svg>
              </div>
              <div className="text-center space-y-1.5">
                <p className="text-sm font-semibold text-white">No assets uploaded yet</p>
                <p className="text-xs text-slate-400 max-w-sm font-light">Get started by uploading presentation media like schematics, slideshow panels, or schematics PDFs.</p>
              </div>
              <button
                onClick={() => setIsModalOpen(true)}
                className="py-2.5 px-5 text-xs font-mono border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all duration-200 cursor-pointer"
              >
                Upload First File
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] font-mono text-slate-400 uppercase tracking-wider pb-4">
                    <th className="pb-4 font-semibold w-16">Preview</th>
                    <th className="pb-4 font-semibold">Name</th>
                    <th className="pb-4 font-semibold hidden md:table-cell">Type</th>
                    <th className="pb-4 font-semibold">Size</th>
                    <th className="pb-4 font-semibold hidden sm:table-cell">Uploaded At</th>
                    <th className="pb-4 font-semibold text-center w-56">Active Pipeline</th>
                    <th className="pb-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {assets.map((asset) => (
                    <tr key={asset.id} className="group hover:bg-white/[0.01] transition-colors">
                      <td className="py-4 pr-4">
                        {asset.kind === "IMAGE" ? (
                          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-white/10 bg-slate-950">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.url}
                              alt={asset.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : asset.kind === "PDF" ? (
                          <div className="w-12 h-12 rounded-lg border border-white/10 bg-purple-500/10 flex items-center justify-center text-purple-400">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          </div>
                        ) : asset.kind === "VIDEO" ? (
                          <div className="w-12 h-12 rounded-lg border border-white/10 bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-lg border border-white/10 bg-slate-800/40 flex items-center justify-center text-slate-400">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        <div className="font-medium text-white max-w-[200px] sm:max-w-xs md:max-w-md truncate" title={asset.name}>
                          {asset.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5 max-w-[200px] truncate" title={asset.url}>
                          {asset.url}
                        </div>
                      </td>
                      <td className="py-4 pr-4 text-slate-300 hidden md:table-cell">
                        <span className="text-xs font-mono bg-slate-800/30 px-2 py-0.5 border border-white/5 rounded text-slate-400">
                          {asset.mimeType}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-slate-300 font-mono text-xs">
                        {formatBytes(asset.size)}
                      </td>
                      <td className="py-4 pr-4 text-slate-400 text-xs hidden sm:table-cell">
                        {new Date(asset.uploadedAt).toLocaleString()}
                      </td>
                      <td className="py-4 px-2">
                        <div className="flex items-center justify-center gap-2">
                          {/* CRT Button */}
                          <button
                            onClick={() => void handleTogglePipelineAsset("CRT", asset)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-mono font-bold tracking-wider transition-all duration-200 border cursor-pointer ${
                              activeCrtAssetId === asset.id
                                ? "bg-amber-400 border-amber-400 text-slate-950 shadow-[0_0_10px_rgba(245,158,11,0.25)]"
                                : "bg-transparent border-amber-500/20 text-amber-400/60 hover:text-amber-400 hover:border-amber-500/40 hover:bg-amber-500/5"
                            }`}
                          >
                            CRT
                          </button>

                          {/* MTU Button */}
                          <button
                            onClick={() => void handleTogglePipelineAsset("MTU", asset)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-mono font-bold tracking-wider transition-all duration-200 border cursor-pointer ${
                              activeMtuAssetId === asset.id
                                ? "bg-cyan-400 border-cyan-400 text-slate-950 shadow-[0_0_10px_rgba(34,211,238,0.25)]"
                                : "bg-transparent border-cyan-500/20 text-cyan-400/60 hover:text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-500/5"
                            }`}
                          >
                            MTU
                          </button>

                          {/* STP Button */}
                          <button
                            onClick={() => void handleTogglePipelineAsset("STP", asset)}
                            className={`px-3 py-1.5 rounded-xl text-[10px] font-mono font-bold tracking-wider transition-all duration-200 border cursor-pointer ${
                              activeStpAssetId === asset.id
                                ? "bg-emerald-400 border-emerald-400 text-slate-950 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
                                : "bg-transparent border-emerald-500/20 text-emerald-400/60 hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/5"
                            }`}
                          >
                            STP
                          </button>
                        </div>
                      </td>
                       <td className="py-4 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <a
                            href={asset.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open file in new tab"
                            className="p-2 rounded-lg border border-white/5 bg-slate-900/40 text-slate-400 hover:text-teal-400 hover:border-teal-500/20 transition-all"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                          <button
                            onClick={() => setAssetToDelete(asset)}
                            title="Delete file"
                            className="p-2 rounded-lg border border-white/5 bg-slate-900/40 text-rose-500 hover:text-rose-400 hover:border-rose-500/25 transition-all cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Pipelines Controller Section */}
        <section className="space-y-6 pb-10">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Active Presentation Pipelines</h2>
            <p className="text-xs text-slate-400 font-light mt-1">
              Drag and drop cards to reorder slides. Click any card to set it as the active display index.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            {/* CRT Pipeline */}
            <div className="p-6 bg-slate-900/10 backdrop-blur-xl border border-white/5 rounded-3xl space-y-4 animate-fade-in">
              <div
                onClick={() => setCrtOpen(!crtOpen)}
                className="flex justify-between items-center cursor-pointer select-none group/hdr hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-sm font-mono font-bold tracking-wider text-amber-400 uppercase">
                    CRT Pipeline
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                    ACTIVE: {crtSlides.find((s) => s.id === crtPipeline?.activeSlideId)?.asset.name ?? "NONE"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-500 group-hover/hdr:text-amber-400 transition-transform duration-300 ${crtOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Horizontal List of Cards */}
              {crtOpen && (
                <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar animate-fade-in">
                  {crtSlides.map((slide, idx) => {
                    const isActive = crtPipeline?.activeSlideId === slide.id;
                    const isDraggingThis = draggedSlide?.pipeline === "crt" && draggedSlide.index === idx;
                    const fileName = slide.asset.name;
                    return (
                      <div
                        key={slide.id}
                        draggable
                        onDragStart={() => handleSlideDragStart("crt", idx)}
                        onDragOver={(e) => handleSlideDragOver(e, idx)}
                        onDragEnd={handleSlideDragEnd}
                        onDrop={() => void handleSlideDrop("crt", idx)}
                        className="flex flex-col gap-1.5 shrink-0 relative"
                      >
                        {/* Drag Insert Indicator Line */}
                        {draggedSlide && draggedSlide.pipeline === "crt" && dragOverSlideIndex === idx && draggedSlide.index !== idx && (
                          <div className={`absolute top-0 bottom-0 w-1 bg-amber-400 ${
                            draggedSlide.index > idx ? "left-0 -translate-x-1" : "right-0 translate-x-1"
                          } rounded-full shadow-[0_0_10px_#f59e0b] animate-pulse z-30`} />
                        )}

                        {/* Index text above the card */}
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[10px] font-mono font-bold text-slate-500">INDEX {idx + 1}</span>
                        </div>

                        {/* Slide Card Container */}
                        <div
                          onClick={() => void handleSetActiveSlide("CRT", slide.assetId)}
                          className={`w-44 border rounded-2xl overflow-hidden p-2 flex flex-col gap-2.5 transition-all duration-300 transform select-none cursor-grab active:cursor-grabbing ${
                            isDraggingThis
                              ? "opacity-20 border-dashed border-amber-500 scale-95"
                              : isActive
                              ? "border-amber-500 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.2)] -translate-y-1"
                              : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-slate-950/80 hover:-translate-y-0.5"
                          }`}
                        >
                          {/* Slide Viewport */}
                          <div className="relative aspect-[16/10] w-full rounded-lg overflow-hidden border border-white/5 bg-slate-900 flex items-center justify-center">
                            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.15)_50%,rgba(0,0,0,0)_50%)] bg-[size:100%_4px] pointer-events-none z-10" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slide.asset.url}
                              alt={fileName || "CRT Slide"}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemoveSlide("CRT", slide.assetId);
                              }}
                              className="absolute top-2 right-2 z-20 p-1 rounded-full bg-slate-950/70 hover:bg-rose-600/90 text-slate-400 hover:text-white border border-white/10 hover:border-rose-500/30 transition-all duration-200 cursor-pointer"
                              title="Remove from pipeline"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Name and active status inside the card border (below the image) */}
                          <div className="flex justify-between items-center px-0.5 pb-0.5">
                            <span className="text-[10px] font-mono font-bold text-slate-300 truncate max-w-[100px]" title={fileName}>
                              {fileName}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                                ACTIVE
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* MTU Pipeline */}
            <div className="p-6 bg-slate-900/10 backdrop-blur-xl border border-white/5 rounded-3xl space-y-4 animate-fade-in">
              <div
                onClick={() => setMtuOpen(!mtuOpen)}
                className="flex justify-between items-center cursor-pointer select-none group/hdr hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-sm font-mono font-bold tracking-wider text-cyan-400 uppercase">
                    MTU Pipeline
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-400/20 px-2 py-0.5 rounded">
                    ACTIVE: {mtuSlides.find((s) => s.id === mtuPipeline?.activeSlideId)?.asset.name ?? "NONE"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-500 group-hover/hdr:text-cyan-400 transition-transform duration-300 ${mtuOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Horizontal List of Cards */}
              {mtuOpen && (
                <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar animate-fade-in">
                  {mtuSlides.map((slide, idx) => {
                    const isActive = mtuPipeline?.activeSlideId === slide.id;
                    const isDraggingThis = draggedSlide?.pipeline === "mtu" && draggedSlide.index === idx;
                    const fileName = slide.asset.name;
                    return (
                      <div
                        key={slide.id}
                        draggable
                        onDragStart={() => handleSlideDragStart("mtu", idx)}
                        onDragOver={(e) => handleSlideDragOver(e, idx)}
                        onDragEnd={handleSlideDragEnd}
                        onDrop={() => void handleSlideDrop("mtu", idx)}
                        className="flex flex-col gap-1.5 shrink-0 relative"
                      >
                        {/* Drag Insert Indicator Line */}
                        {draggedSlide && draggedSlide.pipeline === "mtu" && dragOverSlideIndex === idx && draggedSlide.index !== idx && (
                          <div className={`absolute top-0 bottom-0 w-1 bg-cyan-400 ${
                            draggedSlide.index > idx ? "left-0 -translate-x-1" : "right-0 translate-x-1"
                          } rounded-full shadow-[0_0_10px_#22d3ee] animate-pulse z-30`} />
                        )}

                        {/* Index text above the card */}
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[10px] font-mono font-bold text-slate-500">INDEX {idx + 1}</span>
                        </div>

                        {/* Slide Card Container */}
                        <div
                          onClick={() => void handleSetActiveSlide("MTU", slide.assetId)}
                          className={`w-44 border rounded-2xl overflow-hidden p-2 flex flex-col gap-2.5 transition-all duration-300 transform select-none cursor-grab active:cursor-grabbing ${
                            isDraggingThis
                              ? "opacity-20 border-dashed border-cyan-500 scale-95"
                              : isActive
                              ? "border-cyan-400 bg-cyan-400/5 shadow-[0_0_15px_rgba(6,182,212,0.2)] -translate-y-1"
                              : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-slate-950/80 hover:-translate-y-0.5"
                          }`}
                        >
                          {/* Slide Viewport */}
                          <div className="relative aspect-[16/10] w-full rounded-lg overflow-hidden border border-white/5 bg-slate-900 flex items-center justify-center">
                            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.15)_50%,rgba(0,0,0,0)_50%)] bg-[size:100%_4px] pointer-events-none z-10" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slide.asset.url}
                              alt={fileName || "MTU Slide"}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemoveSlide("MTU", slide.assetId);
                              }}
                              className="absolute top-2 right-2 z-20 p-1 rounded-full bg-slate-950/70 hover:bg-rose-600/90 text-slate-400 hover:text-white border border-white/10 hover:border-rose-500/30 transition-all duration-200 cursor-pointer"
                              title="Remove from pipeline"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Name and active status inside the card border (below the image) */}
                          <div className="flex justify-between items-center px-0.5 pb-0.5">
                            <span className="text-[10px] font-mono font-bold text-slate-300 truncate max-w-[100px]" title={fileName}>
                              {fileName}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-400/20 shrink-0">
                                ACTIVE
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* STP Pipeline */}
            <div className="p-6 bg-slate-900/10 backdrop-blur-xl border border-white/5 rounded-3xl space-y-4 animate-fade-in">
              <div
                onClick={() => setStpOpen(!stpOpen)}
                className="flex justify-between items-center cursor-pointer select-none group/hdr hover:text-white transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-sm font-mono font-bold tracking-wider text-emerald-400 uppercase">
                    STP Pipeline
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded">
                    ACTIVE: {stpSlides.find((s) => s.id === stpPipeline?.activeSlideId)?.asset.name ?? "NONE"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-slate-500 group-hover/hdr:text-emerald-400 transition-transform duration-300 ${stpOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Horizontal List of Cards */}
              {stpOpen && (
                <div className="flex gap-4 overflow-x-auto pb-3 custom-scrollbar animate-fade-in">
                  {stpSlides.map((slide, idx) => {
                    const isActive = stpPipeline?.activeSlideId === slide.id;
                    const isDraggingThis = draggedSlide?.pipeline === "stp" && draggedSlide.index === idx;
                    const fileName = slide.asset.name;
                    return (
                      <div
                        key={slide.id}
                        draggable
                        onDragStart={() => handleSlideDragStart("stp", idx)}
                        onDragOver={(e) => handleSlideDragOver(e, idx)}
                        onDragEnd={handleSlideDragEnd}
                        onDrop={() => void handleSlideDrop("stp", idx)}
                        className="flex flex-col gap-1.5 shrink-0 relative"
                      >
                        {/* Drag Insert Indicator Line */}
                        {draggedSlide && draggedSlide.pipeline === "stp" && dragOverSlideIndex === idx && draggedSlide.index !== idx && (
                          <div className={`absolute top-0 bottom-0 w-1 bg-emerald-400 ${
                            draggedSlide.index > idx ? "left-0 -translate-x-1" : "right-0 translate-x-1"
                          } rounded-full shadow-[0_0_10px_#10b981] animate-pulse z-30`} />
                        )}

                        {/* Index text above the card */}
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[10px] font-mono font-bold text-slate-500">INDEX {idx + 1}</span>
                        </div>

                        {/* Slide Card Container */}
                        <div
                          onClick={() => void handleSetActiveSlide("STP", slide.assetId)}
                          className={`w-44 border rounded-2xl overflow-hidden p-2 flex flex-col gap-2.5 transition-all duration-300 transform select-none cursor-grab active:cursor-grabbing ${
                            isDraggingThis
                              ? "opacity-20 border-dashed border-emerald-500 scale-95"
                              : isActive
                              ? "border-emerald-500 bg-emerald-500/5 shadow-[0_0_15px_rgba(16,185,129,0.2)] -translate-y-1"
                              : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-slate-950/80 hover:-translate-y-0.5"
                          }`}
                        >
                          {/* Slide Viewport */}
                          <div className="relative aspect-[16/10] w-full rounded-lg overflow-hidden border border-white/5 bg-slate-900 flex items-center justify-center">
                            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.15)_50%,rgba(0,0,0,0)_50%)] bg-[size:100%_4px] pointer-events-none z-10" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={slide.asset.url}
                              alt={fileName || "STP Slide"}
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleRemoveSlide("STP", slide.assetId);
                              }}
                              className="absolute top-2 right-2 z-20 p-1 rounded-full bg-slate-950/70 hover:bg-rose-600/90 text-slate-400 hover:text-white border border-white/10 hover:border-rose-500/30 transition-all duration-200 cursor-pointer"
                              title="Remove from pipeline"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Name and active status inside the card border (below the image) */}
                          <div className="flex justify-between items-center px-0.5 pb-0.5">
                            <span className="text-[10px] font-mono font-bold text-slate-300 truncate max-w-[100px]" title={fileName}>
                              {fileName}
                            </span>
                            {isActive && (
                              <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 shrink-0">
                                ACTIVE
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Multi-File Upload Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#040710]/85 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all duration-300 animate-fade-in">
          <div
            className="w-full max-w-xl bg-slate-950 border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 transform scale-100 transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <div>
                <h3 className="text-lg font-bold text-white">Upload Assets</h3>
                <p className="text-xs text-slate-400 font-light mt-0.5">Select or drop multiple presentation files.</p>
              </div>
              <button
                onClick={() => {
                  if (!isUploading) {
                    setIsModalOpen(false);
                    setUploadFiles([]);
                  }
                }}
                disabled={isUploading}
                className="p-2 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Drag & Drop Area */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !isUploading && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-4 text-center cursor-pointer transition-all duration-200 ${
                isDragging
                  ? "border-cyan-400 bg-cyan-950/15 shadow-[0_0_20px_rgba(34,211,238,0.05)]"
                  : "border-white/10 bg-slate-900/20 hover:border-white/20 hover:bg-slate-900/40"
              } ${isUploading ? "pointer-events-none opacity-50" : ""}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="w-12 h-12 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center text-slate-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>

              <div>
                <p className="text-sm font-medium text-white">
                  Drag and drop files here
                </p>
                <p className="text-xs text-slate-400 mt-1 font-light">
                  or <span className="text-cyan-400 font-semibold underline decoration-cyan-400/35 hover:text-cyan-300">browse local files</span>
                </p>
              </div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                SUPPORTS MULTIPLE FILES
              </p>
            </div>

            {/* Selected File List */}
            {uploadFiles.length > 0 && (
              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                  Selected Files ({uploadFiles.length})
                </p>
                <div className="space-y-2">
                  {uploadFiles.map((uf, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 rounded-xl bg-slate-900/50 border border-white/5 text-xs text-slate-300"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* File icon based on upload status */}
                        {uf.status === "uploading" ? (
                          <div className="w-4 h-4 rounded-full border border-cyan-400/25 border-t-cyan-400 animate-spin" />
                        ) : uf.status === "success" ? (
                          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : uf.status === "error" ? (
                          <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-white" title={uf.file.name}>{uf.file.name}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">{formatBytes(uf.file.size)}</p>
                        </div>
                      </div>

                      {!isUploading && uf.status === "pending" && (
                        <button
                          onClick={() => removeUploadFile(index)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
              <button
                type="button"
                disabled={isUploading}
                onClick={() => {
                  setIsModalOpen(false);
                  setUploadFiles([]);
                }}
                className="py-3 px-5 text-xs font-mono font-bold tracking-wider rounded-xl border border-white/5 hover:border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-40"
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={isUploading || uploadFiles.length === 0}
                onClick={handleUploadSubmit}
                className="py-3 px-5 text-xs font-mono font-bold tracking-wider rounded-xl bg-cyan-400 hover:bg-cyan-300 text-[#070b14] transition-all shadow-[0_0_20px_rgba(34,211,238,0.15)] disabled:opacity-30 disabled:shadow-none cursor-pointer"
              >
                {isUploading ? "UPLOADING..." : "UPLOAD FILES"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {assetToDelete && (
        <div
          className="fixed inset-0 bg-[#040710]/85 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all duration-300 animate-fade-in"
          onClick={() => !isDeleting && setAssetToDelete(null)}
        >
          <div
            className="w-full max-w-md bg-slate-950 border border-rose-500/20 rounded-3xl p-6 md:p-8 shadow-2xl flex flex-col gap-6 transform scale-100 transition-all duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-white">Delete Asset</h3>
                <p className="text-xs text-slate-400 font-light mt-1">
                  Are you sure you want to delete this asset? This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Asset Preview Card */}
            <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-900/60 border border-white/5">
              {assetToDelete.kind === "IMAGE" ? (
                <div className="relative w-12 h-12 rounded-xl overflow-hidden border border-white/10 bg-slate-950 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetToDelete.url} alt={assetToDelete.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-xl border border-white/10 bg-purple-500/10 flex items-center justify-center text-purple-400 shrink-0">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate" title={assetToDelete.name}>
                  {assetToDelete.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                  <span>{assetToDelete.kind}</span>
                  <span>•</span>
                  <span>{formatBytes(assetToDelete.size)}</span>
                </div>
              </div>
            </div>

            {/* Warning Note */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 flex items-start gap-2.5">
              <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>This file will be permanently removed from storage and unlinked from active pipelines.</span>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 justify-end pt-2 border-t border-white/5">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setAssetToDelete(null)}
                className="py-2.5 px-5 text-xs font-mono font-bold tracking-wider rounded-xl border border-white/10 hover:border-white/20 text-slate-400 hover:text-white transition-all cursor-pointer disabled:opacity-40"
              >
                CANCEL
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                className="py-2.5 px-5 text-xs font-mono font-bold tracking-wider rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition-all shadow-[0_0_20px_rgba(244,63,94,0.3)] disabled:opacity-40 cursor-pointer flex items-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    DELETING...
                  </>
                ) : (
                  "DELETE ASSET"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
