import React, { useRef, useEffect, useState } from "react";
import { Trash2, Edit3, Palette } from "lucide-react";

interface SignaturePadProps {
  onChange: (base64: string | null) => void;
}

const INSIGHT_COLORS = [
  { name: "Charcoal", hex: "#1e293b", bgClass: "bg-slate-800" },
  { name: "Biru", hex: "#2256f2", bgClass: "bg-blue-600" },
  { name: "Hitam", hex: "#050505", bgClass: "bg-neutral-950" },
  { name: "Merah", hex: "#e11d48", bgClass: "bg-rose-600" },
];

export default function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [selectedColor, setSelectedColor] = useState("#1e293b");

  // Resize canvas to fit container properly
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    // Save image content before resize to avoid blanking
    const ctx = canvas.getContext("2d");
    let tempImage: string | null = null;
    if (!isEmpty) {
      tempImage = canvas.toDataURL();
    }

    const rect = containerRef.current.getBoundingClientRect();
    // Support high DPI screens
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "200px";

    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = selectedColor;

      // Redraw old content
      if (tempImage) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, 200);
        };
        img.src = tempImage;
      }
    }
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [isEmpty]);

  // Start Drawing
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const coords = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setIsDrawing(true);
  };

  // Continue Drawing
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const coords = getCoordinates(e);
    ctx.strokeStyle = selectedColor;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    setIsEmpty(false);
    
    // Propagate the change up
    const base64 = canvas.toDataURL("image/png");
    onChange(base64);
  };

  // End Drawing
  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  // Helper to extract coordinates based on mouse/touch events
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("changedTouches" in e) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  // Clear Signature
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      onChange(null);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Edit3 className="w-3.5 h-3.5 text-emerald-600" /> Tanda Tangan Digital <span className="text-red-500">*</span>
        </label>
        
        <button
          type="button"
          onClick={clear}
          disabled={isEmpty}
          className={`text-[10px] transition-all flex items-center gap-1 font-bold px-2 py-1.5 rounded-lg border ${
            isEmpty 
              ? "bg-slate-50 text-slate-350 border-slate-200 cursor-not-allowed" 
              : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
          }`}
        >
          <Trash2 className="w-3 h-3" /> Bersihkan
        </button>
      </div>

      {/* Signature Canvas Board */}
      <div
        ref={containerRef}
        id="signature-container"
        className="relative w-full border border-slate-200 rounded-2xl bg-slate-50/50 overflow-hidden cursor-crosshair h-[200px]"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="block touch-none"
        />

        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none text-center p-3">
            <span className="text-[11px] text-slate-400 leading-normal">
              Goreskan tanda tangan Anda di area ini<br />
              <span className="text-[9px] italic font-light text-slate-400/80">(Sentuh dengan ujung jari atau stylus HP)</span>
            </span>
          </div>
        )}
      </div>

      {/* Dynamic Stroke Color Selector Row */}
      <div className="flex items-center justify-between pt-1 text-[11px]">
        <span className="text-slate-500 flex items-center gap-1 font-semibold">
          <Palette className="w-3.5 h-3.5 text-slate-450" /> Pilihan Tinta:
        </span>
        <div className="flex items-center gap-2">
          {INSIGHT_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              onClick={() => setSelectedColor(color.hex)}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${color.bgClass} ${
                selectedColor === color.hex 
                  ? "ring-2 ring-emerald-500 ring-offset-2 scale-110 shadow-sm" 
                  : "hover:scale-105 border border-white/20"
              }`}
              title={`Warna ${color.name}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
