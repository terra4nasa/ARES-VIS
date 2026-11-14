"use client";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useStore, type PanelId } from "@/lib/store";

export function PanelFrame({
  id,
  title,
  subtitle,
  children,
}: {
  id: PanelId;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const activePanel = useStore((s) => s.activePanel);
  const openPanel = useStore((s) => s.openPanel);
  if (activePanel !== id) return null;
  return (
    <motion.aside
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="print-brief pointer-events-auto absolute bottom-11 right-0 top-14 z-[540] flex w-full max-w-[430px] flex-col border-l border-[var(--hud-border-dim)] bg-[rgba(6,9,14,0.93)] backdrop-blur-md md:w-[430px]"
      role="complementary"
      aria-label={title}
    >
      <header className="flex items-center justify-between border-b border-[var(--hud-border-dim)] px-4 py-2.5">
        <div>
          <h2 className="font-display text-sm font-bold tracking-[0.2em] text-[var(--hud-amber)] hud-glow">{title}</h2>
          <p className="hud-label mt-0.5">{subtitle}</p>
        </div>
        <button className="hud-btn !min-h-0 !px-2 !py-1" onClick={() => openPanel(null)} aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="hud-scroll flex-1 overflow-y-auto p-4">{children}</div>
    </motion.aside>
  );
}
