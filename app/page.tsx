import { HomeStatus } from "./components/HomeStatus";

export default function Home() {
  return (
    <main className="relative min-h-screen w-full flex flex-col items-center justify-between p-6 md:p-12 lg:p-24 overflow-hidden bg-[#070b14]">
      {/* Background radial glow effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-900/20 via-slate-950 to-slate-950 pointer-events-none" />
      
      {/* Grid Overlay */}
      <div 
        className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" 
        style={{ maskImage: "radial-gradient(ellipse at center, black, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 80%)" }}
      />

      {/* Decorative ambient blobs */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-cyan-500/5 blur-[120px] pointer-events-none animate-pulse-glow" />
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[600px] h-[600px] rounded-full bg-teal-500/5 blur-[140px] pointer-events-none animate-pulse-glow" style={{ animationDelay: "1.5s" }} />

      {/* Top Header Branding */}
      <header className="relative w-full max-w-6xl mx-auto flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-cyan-400 font-mono border border-cyan-400/30 px-2 py-0.5 rounded-full bg-cyan-950/30">
            v1.1
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
          <span>SECURE SYSTEM</span>
          <span>•</span>
          <span>CONSOLE PORT 01</span>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative w-full max-w-4xl mx-auto text-center my-16 md:my-20 space-y-6 z-10">
        <h1 className="text-4xl md:text-7xl font-extrabold tracking-tight text-white select-none">
          Screen Control
          <span className="block mt-2 bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 bg-clip-text text-transparent">
            System Console
          </span>
        </h1>
        <p className="max-w-2xl mx-auto text-base md:text-lg text-slate-400 leading-relaxed font-light">
          Manage system schematics, real-time presentation assets, and live display configurations. Project CRT, MTU, or STP models to the screen wall dynamically.
        </p>
      </section>

      {/* Dynamic Status / Actions Panel */}
      <section className="relative w-full z-10 flex-grow flex items-center">
        <HomeStatus />
      </section>

      {/* Footer */}
      <footer className="relative w-full max-w-6xl mx-auto mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 z-10 text-xs font-mono text-slate-500">
        <p>&copy; {new Date().getFullYear()} Rubenius. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="/admin" className="hover:text-cyan-400 transition-colors">Admin Console</a>
          <a href="/control-center" className="hover:text-cyan-400 transition-colors">Control Center</a>
          <a href="/preview" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-colors">Preview Wall</a>
        </div>
      </footer>
    </main>
  );
}
