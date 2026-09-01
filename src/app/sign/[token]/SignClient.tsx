"use client";
import { useRef, useState } from "react";

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
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
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
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function endDraw() { setDrawing(false); }

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

  if (done) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#166534" }}>Document Signed</div>
          <div style={{ color: "#64748b", marginTop: 8 }}>Thank you, {signerName}. Your signature has been recorded.</div>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#92400e" }}>Link Expired</div>
          <div style={{ color: "#64748b", marginTop: 8 }}>Please contact {senderName} for a new signing link.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 16px" }}>
        {/* Header */}
        <div style={{ background: "#1e40af", borderRadius: 12, padding: "24px 32px", marginBottom: 24, color: "#fff" }}>
          <div style={{ fontSize: 12, color: "#93c5fd", marginBottom: 4 }}>Signature Request from {senderName}</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{docTitle}</div>
        </div>

        {message && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "16px 20px", marginBottom: 20, color: "#0c4a6e", fontSize: 14 }}>
            {message}
          </div>
        )}

        {/* Document preview */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px", marginBottom: 24, maxHeight: 300, overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Document</div>
          <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{docContent}</div>
        </div>

        {/* Signature pad */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>Draw your signature</div>
            <button onClick={clearSig} style={{ fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear</button>
          </div>
          <canvas
            ref={canvasRef}
            width={580}
            height={160}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
            style={{
              width: "100%",
              height: 160,
              border: "2px dashed #cbd5e1",
              borderRadius: 8,
              cursor: "crosshair",
              touchAction: "none",
              background: "#fafafa",
            }}
          />
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            By signing, {signerName || "you"} agree to execute this document electronically.
          </div>
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={submitting || !hasSig}
          style={{
            width: "100%",
            padding: "14px",
            background: hasSig && !submitting ? "#1e40af" : "#94a3b8",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: hasSig && !submitting ? "pointer" : "not-allowed",
          }}
        >
          {submitting ? "Submitting…" : "Sign Document"}
        </button>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "system-ui, sans-serif",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "48px 40px",
  textAlign: "center",
  border: "1px solid #e2e8f0",
  maxWidth: 400,
};
