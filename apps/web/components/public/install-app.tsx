"use client";

import {
  Apple,
  ChevronRight,
  Download,
  EllipsisVertical,
  LockKeyhole,
  Share,
  Smartphone,
  SquarePlus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { useInstallApp } from "@/lib/install-app";
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

type Guide = "ios" | "android";

interface Step {
  text: ReactNode;
  /** A small likeness of what to tap, so the step can be matched to the screen. */
  visual: ReactNode;
}

const STEPS: Record<Guide, Step[]> = {
  ios: [
    { text: <>Safari-д сайтаа нээнэ</>, visual: <AddressBar /> },
    {
      text: <>Доод талын «Хуваалцах» товчийг дарна</>,
      visual: (
        <Target>
          <Share className="size-5 text-[#2f7cf6]" aria-hidden />
        </Target>
      ),
    },
    {
      text: <>Энэ мөрийг сонгоно</>,
      visual: (
        <Target wide>
          <SquarePlus className="size-4" aria-hidden />
          <span>Add to Home Screen</span>
        </Target>
      ),
    },
    {
      text: <>Баруун дээд «Add» дарна</>,
      visual: (
        <Target>
          <span className="font-bold text-[#2f7cf6]">Add</span>
        </Target>
      ),
    },
  ],
  android: [
    { text: <>Chrome-д сайтаа нээнэ</>, visual: <AddressBar /> },
    {
      text: <>Баруун дээд буланд цэсийг дарна</>,
      visual: (
        <Target>
          <EllipsisVertical className="size-5 text-ink" aria-hidden />
        </Target>
      ),
    },
    {
      text: <>Энэ мөрийг сонгоно</>,
      visual: (
        <Target wide>
          <Download className="size-4" aria-hidden />
          <span>Install app</span>
        </Target>
      ),
    },
    {
      text: <>«Install» дарна</>,
      visual: (
        <span className="rounded-pill bg-[#1a5fd6] px-4 py-1.5 text-compact font-bold text-white ring-2 ring-[#ef4444] ring-offset-2">
          Install
        </span>
      ),
    },
  ],
};

function InstallAppDialog({
  install,
  onClose,
}: {
  install: ReturnType<typeof useInstallApp>;
  onClose: () => void;
}) {
  // The phone in hand first; a desktop visitor starts on iPhone and can switch.
  const [guide, setGuide] = useState<Guide>(install.platform === "android" ? "android" : "ios");
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
      <div className="relative w-full max-w-[440px] overflow-hidden rounded-card bg-white text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-pill text-ink hover:bg-white/70"
        >
          <X className="size-6" aria-hidden />
        </button>

        <div className="flex flex-col items-center bg-gradient-to-b from-[#e7f1fd] to-white px-6 pb-4 pt-7 text-center">
          <span className="grid size-24 place-items-center overflow-hidden rounded-card bg-white shadow-lg ring-1 ring-white">
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
          <p className="mt-1.5 text-body leading-6 text-slate-500">
            Утасныхаа үндсэн дэлгэцэд байрлуулаад нэг товшилтоор нэвтэрч байгаарай.
          </p>
        </div>

        <div className="px-5 pb-6">
          <div
            role="tablist"
            aria-label="Утасны төрөл"
            className="grid grid-cols-2 gap-1 rounded-pill bg-slate-100 p-1"
          >
            <GuideTab
              selected={guide === "ios"}
              onSelect={() => setGuide("ios")}
              icon={<Apple className="size-5" aria-hidden />}
              label="iPhone"
            />
            <GuideTab
              selected={guide === "android"}
              onSelect={() => setGuide("android")}
              icon={
                <Image
                  src="/icons/brand-android.png"
                  alt=""
                  width={20}
                  height={20}
                  unoptimized
                  className="size-5"
                />
              }
              label="Android"
            />
          </div>

          {guide === "android" && install.canPrompt ? (
            <button
              type="button"
              onClick={installNow}
              disabled={installing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-pill bg-gradient-to-r from-[#1f45a6] to-[#7a4fe0] px-5 py-3.5 text-lead font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-60"
            >
              <Download className="size-5" aria-hidden />
              Одоо суулгах
            </button>
          ) : null}

          <ol
            role="tabpanel"
            aria-label={guide === "ios" ? "iPhone" : "Android"}
            className="mt-4 space-y-2.5"
          >
            {STEPS[guide].map((step, index) => (
              <li
                key={index}
                className="flex items-center gap-3 rounded-row bg-slate-50 px-3 py-3 ring-1 ring-slate-100"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-gradient-to-b from-[#3f86ef] to-[#5a58c4] text-compact font-extrabold text-white shadow-sm">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 text-body font-semibold leading-snug text-[#102f5d]">
                  {step.text}
                </span>
                <span className="flex shrink-0 justify-end">{step.visual}</span>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex items-center gap-3 rounded-row bg-[#ecfdf3] px-3 py-3 ring-1 ring-[#c9f2d8]">
            <span className="size-11 shrink-0 overflow-hidden rounded-control shadow-sm">
              <Image
                src="/icons/pwa-192.png"
                alt=""
                width={44}
                height={44}
                unoptimized
                className="size-full"
              />
            </span>
            <span className="text-body font-semibold leading-snug text-[#14532d]">
              Болоо! Үндсэн дэлгэц дээр {BRAND_LATIN} гарч ирнэ.
            </span>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

function GuideTab({
  selected,
  onSelect,
  icon,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 items-center justify-center gap-2 rounded-pill text-body font-bold transition",
        selected ? "bg-white text-[#102f5d] shadow-sm" : "text-slate-500 hover:text-[#102f5d]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** What to look for, ringed in red — as the client's drawing does. */
function Target({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-check bg-white text-caption font-semibold text-ink shadow-sm ring-2 ring-[#ef4444]",
        wide ? "px-2.5 py-1.5" : "size-9 justify-center",
      )}
    >
      {children}
    </span>
  );
}

function AddressBar() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-white px-2.5 py-1.5 text-caption font-semibold text-ink shadow-sm ring-1 ring-slate-200">
      <LockKeyhole className="size-3" aria-hidden />
      nomadkids.mn
    </span>
  );
}
