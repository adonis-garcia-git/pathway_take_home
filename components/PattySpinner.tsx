"use client";
import React, { useEffect, useState } from "react";
import { Patty } from "@/components/ui";

export function PattySpinner({
  lines,
  size = 96,
  intervalMs = 2800,
}: {
  lines: string[];
  size?: number;
  intervalMs?: number;
}) {
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (lines.length <= 1) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setI((n) => (n + 1) % lines.length);
        setVisible(true);
      }, 280);
    }, intervalMs);
    return () => clearInterval(t);
  }, [lines.length, intervalMs]);

  const disc = Math.round(size * 1.33);

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10">
      <span
        className="inline-flex items-center justify-center rounded-full bg-mint border border-patty/40 [animation:spin_6s_linear_infinite]"
        style={{ width: disc, height: disc }}
      >
        <Patty size={size} />
      </span>
      <span
        className={
          "text-[14px] text-ink-2 text-center max-w-[420px] transition-opacity duration-300 " +
          (visible ? "opacity-100" : "opacity-0")
        }
      >
        {lines[i]}
      </span>
    </div>
  );
}
