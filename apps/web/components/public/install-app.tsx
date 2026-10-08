"use client";

import {
  Apple,
  ChevronDown,
  ChevronRight,
  Download,
  EllipsisVertical,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { useInstallApp, type InstallPlatform } from "@/lib/install-app";
import { BRAND_LATIN } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";

/**
 * «NomadKids-ийг утсандаа суулгах» — the card under the hero, and the sheet it
 * opens. 2026-10-08, to the client's drawing.
 *
 * ★ Hidden once the site is already running from the home screen: offering to
 * install the thing you are using is noise.
 */
export function InstallAppCard({ className }: { className?: string }) {
  const install = useInstallApp();
  const [open, setOpen] = useState(false);

  if (install.ready && install.installed) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center gap-4 rounded-card bg-[#eef0ff] px-5 py-4 text-left shadow-sm ring-1 ring-[#dfe3ff] transition hover:bg-[#e6e9ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3f86ef]",
          className,
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-control bg-gradient-to-b from-[#3f86ef] to-[#5a58c4] text-white shadow-sm">
          <Smartphone className="size-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-title font-extrabold leading-tight text-[#102f5d]">
            {BRAND_LATIN}-ийг утсандаа суулгах
          </span>
          <span className="mt-0.5 block text-compact text-[#5b63c8]">
            Апп дэлгүүрээс татах шаардлагагүй
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-[#102f5d]" aria-hidden />
      </button>
      {open ? <InstallAppDialog install={install} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InstallAppDialog({
  install,
  onClose,
}: {
  install: ReturnType<typeof useInstallApp>;
  onClose: () => void;
}) {
  // The phone in hand opens first; a desktop visitor chooses.
  const [expanded, setExpanded] = useState<InstallPlatform | null>(
    install.platform === "other" ? null : install.platform,
  );
  const [installing, setInstalling] = useState(false);

  async function installNow() {
    setInstalling(true);
    try {
      if (await install.prompt()) onClose();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <ModalOverlay label={`${BRAND_LATIN}-ийг утсандаа суулгах`} onClose={onClose}>
      {/* `text-left`: the card sits inside the hero, whose `text-center` would
          otherwise reach the steps through the overlay. */}
      <div className="relative w-full max-w-[420px] rounded-card bg-white p-6 text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-3 top-3 grid size-11 place-items-center rounded-pill text-ink hover:bg-slate-100"
        >
          <X className="size-6" aria-hidden />
        </button>

        <div className="flex flex-col items-center text-center">
          <span className="grid size-24 place-items-center overflow-hidden rounded-card bg-[#e7f1fd] shadow-sm">
            <Image
              src="/icons/pwa-192.png"
              alt=""
              width={96}
              height={96}
              unoptimized
              priority
              className="size-full"
            />
          </span>
          <h2 className="mt-4 text-heading font-extrabold leading-tight text-[#102f5d]">
            {BRAND_LATIN}-ийг утсандаа суулгах
          </h2>
          <p className="mt-2 text-body leading-6 text-slate-500">
            Сайтаа утасныхаа үндсэн дэлгэцэд байрлуулаад нэг товшилтоор нэвтэрч байгаарай.
          </p>
        </div>

        {install.canPrompt ? (
          <Button block className="mt-5" onClick={installNow} disabled={installing}>
            <Download className="size-5" aria-hidden />
            Одоо суулгах
          </Button>
        ) : null}

        <div className="mt-5 space-y-3">
          <PlatformGuide
            id="ios"
            icon={<Apple className="size-7" aria-hidden />}
            title="iPhone (iOS)"
            browser="Safari"
            open={expanded === "ios"}
            onToggle={() => setExpanded(expanded === "ios" ? null : "ios")}
            steps={[
              <>Safari-д nomadkids.mn сайтыг нээнэ</>,
              <>
                Доод талын <Share className="inline size-4 align-[-2px]" aria-label="Хуваалцах" />{" "}
                «Хуваалцах» товчийг дарна
              </>,
              <>
                <SquarePlus className="inline size-4 align-[-2px]" aria-hidden /> «Add to Home
                Screen» сонгоно
              </>,
              <>«Add» дарна — үндсэн дэлгэц дээр {BRAND_LATIN} гарна</>,
            ]}
          />
          <PlatformGuide
            id="android"
            icon={<AndroidMark className="size-7" />}
            title="Android"
            browser="Chrome"
            open={expanded === "android"}
            onToggle={() => setExpanded(expanded === "android" ? null : "android")}
            steps={[
              <>Chrome-д nomadkids.mn сайтыг нээнэ</>,
              <>
                Баруун дээд буланд{" "}
                <EllipsisVertical className="inline size-4 align-[-2px]" aria-label="Цэс" /> цэсийг
                дарна
              </>,
              <>«Install app» эсвэл «Add to Home screen» сонгоно</>,
              <>«Install» дарна — үндсэн дэлгэц дээр {BRAND_LATIN} гарна</>,
            ]}
          />
        </div>
      </div>
    </ModalOverlay>
  );
}

function PlatformGuide({
  id,
  icon,
  title,
  browser,
  open,
  onToggle,
  steps,
}: {
  id: InstallPlatform;
  icon: ReactNode;
  title: string;
  browser: string;
  open: boolean;
  onToggle: () => void;
  steps: ReactNode[];
}) {
  const panelId = `install-steps-${id}`;
  return (
    <div className="rounded-row bg-slate-50 ring-1 ring-slate-100">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-16 w-full items-center gap-4 px-4 py-3 text-left"
      >
        <span className={cn("shrink-0", id === "android" ? "text-[#3ddc84]" : "text-ink")}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-title font-bold text-[#102f5d]">{title}</span>
          <span className="block text-compact text-[#3f86ef]">
            {open ? `${browser}-аар суулгах заавар` : "Суулгах заавар харах"}
          </span>
        </span>
        <ChevronDown
          className={cn("size-5 shrink-0 text-[#102f5d] transition", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? (
        <ol id={panelId} className="space-y-2.5 px-4 pb-4">
          {steps.map((step, index) => (
            <li key={index} className="flex items-start gap-3 text-body text-ink">
              <span className="grid size-6 shrink-0 place-items-center rounded-pill bg-[#3f86ef] text-caption font-bold text-white">
                {index + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** The Android robot's head — lucide carries no brand marks. */
function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.6 9.48l1.84-3.18a.38.38 0 0 0-.66-.38l-1.86 3.22a11.4 11.4 0 0 0-9.84 0L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48A10.8 10.8 0 0 0 1 18h22a10.8 10.8 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
    </svg>
  );
}
