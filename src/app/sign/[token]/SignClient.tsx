"use client";
import { useRef, useState } from "react";
import { CheckCircle, Clock, AlertTriangle } from "lucide-react";

interface Props {
  token: string;
  signerName: string;
  senderName: string;
  docTitle: string;
  docContent: string;
  message: string;
  expired: boolean;
  signed: boolean;
}

export default function SignClient({
  token, signerName, senderName, docTitle, docContent, message, expired, signed,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(signed);
  const [error, setError] = useState("");

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: ((e as React.MouseEvent).clientX - rect.left) * scaleX,
      y: ((e as React.MouseEvent).clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
    setHasSig(true);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function clearSig() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  }

  async function submit() {
    if (!hasSig) { setError("Please draw your signature first."); return; }
    setSubmitting(true);
    setError("");
    const sigDataUrl = canvasRef.current!.toDataURL("image/png");
    const res = await fetch(`/api/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sigDataUrl }),
    });
    if (res.ok) {
      setDone(true);
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  if (done) return (
    <Shell>
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle className="text-green-500" size={32} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Document Signed</h2>
        <p className="mt-2 text-sm text-gray-500">
          Thank you{signerName ? `, ${signerName}` : ""}. Your signature has been recorded securely.
        </p>
        <div className="mt-6 rounded-lg bg-gray-50 px-5 py-3 text-sm text-gray-500">
          A confirmation has been logged. You may close this window.
        </div>
      </div>
    </Shell>
  );

  if (expired) return (
    <Shell>
      <div className="flex flex-col items-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
          <Clock className="text-amber-500" size={32} />
        </div>
        <h2 className="text-xl font-semibold text-gray-900">Link Expired</h2>
        <p className="mt-2 text-sm text-gray-500">
          This signing link has expired. Please contact <strong>{senderName}</strong> for a new link.
        </p>
      </div>
    </Shell>
  );

  return (
    <Shell>
      {/* From */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-5 py-4 mb-5">
        <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1">Signature Request</p>
        <p className="text-sm text-blue-900">
          <strong>{senderName}</strong> has requested your signature on{" "}
          <strong>&ldquo;{docTitle}&rdquo;</strong>
        </p>
      </div>

      {/* Optional message */}
      {message && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Note from sender</p>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{message}</p>
        </div>
      )}

      {/* Document content */}
      <div className="mb-5 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Document</p>
          <span className="text-xs text-gray-400">{docTitle}</span>
        </div>
        <div className="max-h-56 overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 leading-relaxed">{docContent}</pre>
        </div>
      </div>

      {/* Signature pad */}
      <div className="mb-5 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Draw your signature</p>
          <button
            onClick={clearSig}
            className="text-xs text-gray-400 underline hover:text-gray-600"
          >
            Clear
          </button>
        </div>
        <div className="p-4">
          <canvas
            ref={canvasRef}
            width={640}
            height={160}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={() => setDrawing(false)}
            onMouseLeave={() => setDrawing(false)}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={() => setDrawing(false)}
            className="w-full rounded-md border-2 border-dashed border-gray-200 bg-gray-50 cursor-crosshair"
            style={{ height: 140, touchAction: "none" }}
          />
          {!hasSig && (
            <p className="mt-2 text-center text-xs text-gray-400">Sign above using your mouse or finger</p>
          )}
        </div>
      </div>

      {/* Consent line */}
      <p className="mb-4 text-xs text-gray-400 text-center">
        By clicking &ldquo;Sign Document&rdquo;, {signerName || "you"} agree to execute this document with an electronic signature, which is legally binding.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !hasSig}
        className="w-full rounded-lg py-3.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        style={{ background: hasSig ? "#1e40af" : "#94a3b8", cursor: hasSig ? "pointer" : "not-allowed" }}
      >
        {submitting ? "Submitting…" : "Sign Document"}
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
      `}</style>
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        {/* Top bar */}
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 20px", height: 52, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 5, background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12 }}>D</div>
          <span style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>DocKaro</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "2px 8px", borderRadius: 999, fontWeight: 500 }}>Secure Document Signing</span>
        </div>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px 80px" }}>
          {children}
        </div>
      </div>
    </>
  );
}
