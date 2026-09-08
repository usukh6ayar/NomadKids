"use client";

import { Download, Gift } from "lucide-react";
import type { AgeProfile } from "@kinder/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  profile,
}: {
  age: Age;
  childName: string;
  profile: AgeProfile | undefined;
}) {
  const completion = ageProfileCompletion(profile);
  const label = `${age} насны дурсамж ${completion.percent}% бөглөгдсөн`;

  return (
    <Card className="overflow-hidden p-3 md:px-4 md:py-3.5">
      <section aria-labelledby="age-memory-progress-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="age-memory-progress-title" className="text-caption font-medium text-ink">
            {age} насны дурсамж
          </h2>
          <strong className="shrink-0 text-caption font-bold tabular-nums text-primary">
            {completion.percent}%
          </strong>
        </div>
        <div
          role="progressbar"
          aria-valuenow={completion.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-track"
        >
          <span
            className="block h-full rounded-pill bg-primary transition-[width]"
            style={{ width: `${completion.percent}%` }}
          />
        </div>

        {completion.percent === 100 ? (
          <div className="mt-3 flex flex-col gap-3 rounded-row bg-[linear-gradient(135deg,#60a5fa_0%,#8b5cf6_100%)] p-3 text-white sm:flex-row sm:items-center sm:justify-between">
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
