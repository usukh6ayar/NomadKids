"use client";

import {
  Baby,
  BookOpen,
  Building2,
  ChevronDown,
  CreditCard,
  FolderHeart,
  House,
  Image as ImageIcon,
  KeyRound,
  MessageCircle,
  MessageSquareText,
  Music2,
  Newspaper,
  Search,
  Settings,
  Ticket,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import type { GuideGroup, GuideIcon } from "@/lib/guides";

const ICON: Record<GuideIcon, LucideIcon> = {
  home: House,
  child: Baby,
  portfolio: FolderHeart,
  kindergarten: Building2,
  news: Newspaper,
  photos: ImageIcon,
  food: UtensilsCrossed,
  songs: Music2,
  chat: MessageCircle,
  feedback: MessageSquareText,
  finance: CreditCard,
  access: Ticket,
  settings: Settings,
  password: KeyRound,
};

/**
 * «Гарын авлага» — every section's guide in one window (2026-10-13, the
 * user: "илүү мэргэжлийн"). Grouped by subject, searchable, each section an
 * icon, a one-line summary and numbered steps that fold open on their own, so
 * the list stays short on a phone. «Холбоо барих» closes it for the question a
 * guide does not answer.
 */
export function GuideDialog({
  groups,
  onClose,
  onContact,
}: {
  groups: GuideGroup[];
  onClose: () => void;
  /** Opens «Холбоо барих» — the way out when no guide answers. */
  onContact?: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("mn");
  const visible = groups
    .map((group) => ({
      ...group,
      guides: group.guides.filter(
        (guide) =>
          !needle ||
          [guide.title, guide.summary, ...guide.steps].some((text) =>
            text.toLocaleLowerCase("mn").includes(needle),
          ),
      ),
    }))
    .filter((group) => group.guides.length > 0);

  return (
    <ModalOverlay label="Гарын авлага" onClose={onClose}>
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[480px] flex-col overflow-hidden rounded-card bg-white text-left shadow-xl">
        <header className="border-b border-border-soft px-5 pb-4 pt-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100 hover:text-[#173e70]"
          >
            <X className="size-5" aria-hidden />
          </button>
          <div className="flex items-center gap-3 pr-8">
            <span className="grid size-10 shrink-0 place-items-center rounded-control bg-[#edf6ff] text-[#2f6fd6]">
              <BookOpen className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lead font-extrabold leading-tight text-[#102f5d]">
                Гарын авлага
              </h2>
              <p className="text-caption text-slate-500">Эцэг эх, асран хамгаалагчид зориулав</p>
            </div>
          </div>
          <label className="relative mt-4 block">
            <span className="sr-only">Гарын авлагаас хайх</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Хайх: төлбөр, нууц үг, хоол…"
              className="h-11 w-full rounded-control border border-border bg-canvas pl-9 pr-3 text-body text-ink outline-none focus:border-primary focus:bg-white"
            />
          </label>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-caption text-slate-500">
              Илэрц олдсонгүй. Өөр үгээр хайж үзнэ үү.
            </p>
          ) : (
            visible.map((group) => (
              <section key={group.title} className="mb-3 last:mb-0">
                <h3 className="py-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-slate-400">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {group.guides.map((guide) => {
                    const Icon = ICON[guide.icon];
                    return (
                      <li key={guide.title}>
                        <details
                          className="group rounded-control border border-border-soft open:border-[#cfe3fb] open:bg-[#f7fbff]"
                          open={Boolean(needle)}
                        >
                          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                            <span className="grid size-9 shrink-0 place-items-center rounded-control bg-[#edf6ff] text-[#2f6fd6]">
                              <Icon className="size-[18px]" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-body font-semibold text-[#173e70]">
                                {guide.title}
                              </span>
                              <span className="block truncate text-caption text-slate-500">
                                {guide.summary}
                              </span>
                            </span>
                            <ChevronDown
                              className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                              aria-hidden
                            />
                          </summary>
                          <ol className="flex flex-col gap-2 px-3 pb-3 pl-[60px]">
                            {guide.steps.map((step, index) => (
                              <li
                                key={step}
                                className="flex gap-2.5 text-caption leading-5 text-slate-600"
                              >
                                <span
                                  aria-hidden
                                  className="grid size-5 shrink-0 place-items-center rounded-pill bg-[#2f6fd6] text-caption font-bold text-white"
                                >
                                  {index + 1}
                                </span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        {onContact ? (
          <footer className="border-t border-border-soft px-5 py-3 text-center text-caption text-slate-500">
            Хариулт олдсонгүй юу?{" "}
            <button
              type="button"
              onClick={onContact}
              className="font-semibold text-[#2f6fd6] hover:underline"
            >
              Холбоо барих
            </button>
          </footer>
        ) : null}
      </div>
    </ModalOverlay>
  );
}
