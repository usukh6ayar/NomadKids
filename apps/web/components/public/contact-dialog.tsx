"use client";

import { Mail, Phone, X } from "lucide-react";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { CONTACT } from "@/lib/contact";

/**
 * «Холбоо барих» — phone, e-mail and Facebook in a small window. The home
 * page's menu opens it, and since 2026-10-13 so does «Тусламж» in the
 * guardian's menu (the user: "нэвтрэх хэсэгтэй ижил цонхоор").
 */
export function ContactDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    {
      icon: <Phone className="size-5" aria-hidden />,
      label: "Утас",
      value: CONTACT.phone,
      href: CONTACT.phoneHref,
    },
    {
      icon: <Mail className="size-5" aria-hidden />,
      label: "Мэйл",
      value: CONTACT.email,
      href: CONTACT.emailHref,
    },
    {
      icon: <FacebookIcon className="size-5" />,
      label: "Facebook",
      value: "Facebook хуудас",
      href: CONTACT.facebook,
      external: true,
    },
  ];
  return (
    <ModalOverlay label="Холбоо барих" onClose={onClose}>
      <div className="relative w-full max-w-[340px] rounded-card bg-white p-5 text-left shadow-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="absolute right-2 top-2 grid size-10 place-items-center rounded-pill text-slate-500 hover:bg-slate-100 hover:text-[#173e70]"
        >
          <X className="size-5" aria-hidden />
        </button>
        <h2 className="text-lead font-extrabold text-[#102f5d]">Холбоо барих</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label}>
              <a
                href={row.href}
                {...(row.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex min-h-12 items-center gap-3 rounded-control px-2 hover:bg-[#edf6ff]"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-[#edf6ff] text-[#3f86ef]">
                  {row.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-caption text-slate-500">{row.label}</span>
                  <span className="block truncate text-body font-semibold text-[#173e70]">
                    {row.value}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </ModalOverlay>
  );
}
