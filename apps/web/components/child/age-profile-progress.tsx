"use client";

import { Download, Gift } from "lucide-react";
import type { AgeProfile } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Art } from "@/components/ui/art";
import type { PORTFOLIO_AGES } from "@/lib/portfolio-ages";
import { FAVORITE_FIELDS, ageSectionCompletion } from "@/lib/age-development";

type Age = (typeof PORTFOLIO_AGES)[number];

export function ageProfileCompletion(profile: AgeProfile | undefined) {
  const { completed, total, percent } = ageSectionCompletion(profile);
  return { completed, total, percent };
}

export function AgeProfileProgress({
  age,
  childName,
  childSex,
  profile,
}: {
  age: Age;
  childName: string;
  childSex?: "MALE" | "FEMALE" | null;
  profile: AgeProfile | undefined;
}) {
  const completion = ageProfileCompletion(profile);
  const label = `${age} насны дурсамж ${completion.percent}% бөглөгдсөн`;
  const pointingArt = childSex === "FEMALE" ? "agePointingGirl" : "agePointingBoy";

  return (
    <Card className="overflow-hidden border-white bg-[linear-gradient(135deg,#ffffff_0%,#f3f9ff_100%)] p-0 shadow-sm">
      <section aria-labelledby="age-memory-progress-title">
        <h2 id="age-memory-progress-title" className="sr-only">
          {age} насны дурсамж
        </h2>
        <div className="relative grid min-h-[144px] grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-3 overflow-hidden px-4 py-3 sm:min-h-[168px] sm:grid-cols-[112px_minmax(0,1fr)_132px] sm:gap-5 sm:px-6">
          <div
            role="progressbar"
            aria-valuenow={completion.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
            className="grid size-[88px] shrink-0 place-items-center rounded-pill p-2 sm:size-28 sm:p-2.5"
            style={{
              background: `conic-gradient(#60a5fa ${completion.percent}%, #dbeafe ${completion.percent}% 100%)`,
            }}
          >
            <span className="grid size-full place-items-center rounded-pill bg-white text-heading font-bold tabular-nums text-ink shadow-inner sm:text-display">
              {completion.percent}%
            </span>
          </div>

          <div className="relative z-10 min-w-0">
            <strong className="block text-heading font-bold tabular-nums text-ink sm:text-display">
              {completion.completed} / {completion.total}
            </strong>
            <span className="mt-0.5 block text-caption font-semibold leading-snug text-ink sm:text-body">
              хэсэг бүртгэсэн
            </span>
          </div>

          <div
            aria-hidden="true"
            className="relative h-full min-h-[132px] w-full self-end sm:min-h-[156px]"
            data-testid="age-progress-character"
          >
            <Art
              name={pointingArt}
              size={220}
              className="absolute bottom-[-12px] right-[-16px] h-36 w-36 max-w-none object-contain object-bottom sm:bottom-[-16px] sm:right-[-18px] sm:h-48 sm:w-48"
            />
          </div>
        </div>

        {completion.percent === 100 ? (
          <div className="m-3 mt-0 flex flex-col gap-3 rounded-row bg-[linear-gradient(135deg,#60a5fa_0%,#8b5cf6_100%)] p-3 text-white sm:mx-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-white/20"
              >
                <Gift size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold">Миний {age} насны цахим карт</h3>
                <p className="mt-0.5 text-caption text-white/85">Дурсамжийн картаа хадгалаарай.</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => downloadAgeCard({ age, childName, profile: profile! })}
            >
              <Download aria-hidden="true" />
              Зургаар татах
            </Button>
          </div>
        ) : null}
      </section>
    </Card>
  );
}

function downloadAgeCard({
  age,
  childName,
  profile,
}: {
  age: Age;
  childName: string;
  profile: AgeProfile;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1500;
  const context = canvas.getContext("2d");
  if (!context) return;

  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#dff4ff");
  background.addColorStop(0.52, "#eef2ff");
  background.addColorStop(1, "#fce7f3");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(255,255,255,.94)";
  roundedRect(context, 90, 90, 1020, 1320, 48);
  context.fill();

  context.textAlign = "center";
  context.fillStyle = "#2563eb";
  context.font = "700 38px system-ui, sans-serif";
  context.fillText("NOMAD KIDS · ДУРСАМЖИЙН КАРТ", 600, 180);
  context.fillStyle = "#172b4d";
  context.font = "700 72px system-ui, sans-serif";
  context.fillText(`Миний ${age} нас`, 600, 285);
  context.font = "600 42px system-ui, sans-serif";
  context.fillText(childName, 600, 350);

  const favorite =
    FAVORITE_FIELDS.map(({ key }) => profile[key]).find((value) => value?.trim()) ?? "—";
  const kindergarten = [
    ...profile.kindergartenSkills,
    profile.kindergartenOtherSkill ?? profile.newSkills,
  ]
    .filter(Boolean)
    .join(", ");
  const familyLearning = [
    ...profile.familyLearningSkills,
    profile.familyLearningOther ?? profile.familyMembers,
  ]
    .filter(Boolean)
    .join(", ");
  const character = [
    ...profile.characterTraits,
    profile.characterObservation ?? profile.personality ?? profile.emotionalTraits,
  ]
    .filter(Boolean)
    .join(", ");
  const family = [profile.familyMemberTypes.join(", "), profile.familyDescription]
    .filter(Boolean)
    .join(" · ");
  const rows = [
    ["Миний дуртай зүйл", favorite],
    ["Цэцэрлэгтээ сурсан зүйл", kindergarten || "—"],
    ["Гэр бүлээсээ сурсан зүйл", familyLearning || "—"],
    ["Миний зан араншин", character || "—"],
    ["Гэр бүл", family || "—"],
  ] as const;

  let y = 455;
  for (const [heading, value] of rows) {
    context.textAlign = "left";
    context.fillStyle = "#2563eb";
    context.font = "700 30px system-ui, sans-serif";
    context.fillText(heading, 155, y);
    context.fillStyle = "#263b59";
    context.font = "400 31px system-ui, sans-serif";
    y = drawWrappedText(context, value, 155, y + 48, 890, 42) + 55;
  }

  context.textAlign = "center";
  context.fillStyle = "#16a36a";
  context.font = "700 32px system-ui, sans-serif";
  context.fillText("✓ 100% бөглөгдсөн", 600, 1340);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = childName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
    anchor.href = url;
    anchor.download = `${safeName || "huuhed"}-${age}-nas-cahim-kart.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.trim().split(/\s+/);
  let line = "";
  let cursorY = y;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      context.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, cursorY);
  return cursorY;
}
