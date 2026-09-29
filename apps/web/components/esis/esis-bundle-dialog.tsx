"use client";

import { useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { EsisResourceKey } from "@kinder/contracts";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { Button } from "@/components/ui/button";

export interface EsisBundleResource {
  resource: EsisResourceKey;
  title?: string;
  description?: string;
  params?: Record<string, string | undefined>;
}

/** One contextual button that reads every ESIS service needed by a screen. */
export function EsisBundleButton({
  resources,
  title,
  description,
  label = "ESIS татах",
  onOpen,
  className,
}: {
  resources: EsisBundleResource[];
  title: string;
  description?: string;
  label?: string;
  onOpen?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className={className}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        <RefreshCw size={16} aria-hidden /> {label}
      </Button>
      {open ? (
        <EsisBundleDialog
          resources={resources}
          title={title}
          description={description}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function EsisBundleDialog({
  resources,
  title,
  description,
  onClose,
}: {
  resources: EsisBundleResource[];
  title: string;
  description?: string;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 overflow-y-auto bg-ink/50 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-5 rounded-card border border-border bg-canvas p-4 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Хаах"
          onClick={onClose}
          className="absolute right-3 top-3 grid size-9 place-items-center rounded-control text-muted hover:bg-surface hover:text-ink"
        >
          <X size={18} aria-hidden />
        </button>
        <div className="pr-10">
          <h2 className="text-title font-bold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-body text-muted">{description}</p> : null}
        </div>
        {resources.map((item) => (
          <EsisDataPanel
            key={item.resource}
            resource={item.resource}
            params={item.params}
            title={item.title}
            description={item.description}
            autoRead
            showResponseDetails
          />
        ))}
      </div>
    </div>
  );
}
