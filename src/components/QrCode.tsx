"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Renders a QR code as inline SVG (generated locally, no external service). */
export function QrCode({ value, className = "", label }: { value: string; className?: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0620", light: "#ffffff" } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return (
    <div
      role="img"
      aria-label={label}
      className={`rounded-3xl bg-white p-3 ${className}`}
      // SVG markup is produced by the qrcode library from our own URL.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
