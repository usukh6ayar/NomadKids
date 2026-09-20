import { z } from "zod";

/**
 * Zod's error messages, in Mongolian.
 *
 * ★ **Why a locale and not 436 hand-written messages.** `ZodValidationPipe`
 * puts `issue.message` straight into `problem.errors[field]`, and
 * `apps/web/lib/api/errors.ts`'s `fieldErrors()` renders it under the input.
 * So every constraint with no `message` argument printed English at the user:
 * a count on 2026-09-20 found 436 bare `.min()`/`.max()`/`.length()` calls
 * against 54 annotated ones. Annotating the other 436 is the version of this
 * fix that is out of date the first time somebody adds a field.
 *
 * ★★ Zod 4 ships 53 locales and **no `mn`**, so this is one. It implements the
 * same contract as `zod/v4/locales/en.js` — a function returning
 * `{ localeError }` — and is installed once, from this package's entry point,
 * which `apps/api` and `apps/web` both import. All three resolve the same
 * `zod@4.4.3` instance (verified), so one `z.config()` reaches both.
 *
 * ★★★ **Ablative, not literal.** "Too small: expected string to have >=20
 * characters" translated word for word is not a sentence anybody reads. The
 * unit declines with what is being counted — тэмдэгт, зүйл, байт — and the
 * number takes `-ээс/-аас`, so the tables below carry the suffix rather than
 * building it, which no rule could get right for every numeral.
 *
 * ★★★★ A field-specific message still wins. `z.string().min(1, "Бүлгийн
 * нэрийг оруулна уу")` overrides this for that one field, and should, wherever
 * the product can say something better than a generic sentence can.
 */

/** What is being counted, and the form the count takes after it. */
const UNITS: Record<string, { one: string; ablative: string }> = {
  string: { one: "тэмдэгт", ablative: "тэмдэгтээс" },
  array: { one: "зүйл", ablative: "зүйлээс" },
  set: { one: "зүйл", ablative: "зүйлээс" },
  map: { one: "бичлэг", ablative: "бичлэгээс" },
  file: { one: "байт", ablative: "байтаас" },
  number: { one: "", ablative: "" },
  bigint: { one: "", ablative: "" },
  int: { one: "", ablative: "" },
  date: { one: "", ablative: "" },
};

/**
 * The named string formats, as a Mongolian noun phrase.
 *
 * ★ Only the ones this product actually validates carry a translation. The
 * rest fall through to the raw format name, which is a developer-facing string
 * reaching a developer-facing failure — better than a wrong Mongolian guess at
 * "ksuid".
 */
const FORMATS: Record<string, string> = {
  email: "и-мэйл хаяг",
  url: "холбоос",
  uuid: "танигч",
  guid: "танигч",
  datetime: "огноо, цаг",
  date: "огноо",
  time: "цаг",
  duration: "үргэлжлэх хугацаа",
  ipv4: "IPv4 хаяг",
  ipv6: "IPv6 хаяг",
  base64: "base64 утга",
  json_string: "JSON утга",
  jwt: "токен",
  emoji: "эможи",
  regex: "утга",
  template_literal: "утга",
};

/**
 * Type names a message may have to say out loud.
 *
 * ★ **The full set Zod can emit**, not a guess — obtained by parsing a wrong
 * value against every schema constructor and collecting `issue.expected`:
 * array, bigint, int, map, never, null, number, object, record, set, symbol,
 * tuple, undefined, void, plus string/boolean/date/nan. `int` was the one that
 * escaped a first pass and reached a screen as "int оруулна уу", which is the
 * argument for enumerating rather than listing the ones that came to mind.
 *
 * ★★ Several collapse deliberately. A parent does not distinguish a tuple from
 * an array or a record from an object, and `never`/`void`/`symbol` cannot be
 * produced by a form at all — they are contract failures, and «утга буруу
 * байна» is the honest thing to tell whoever managed to trigger one.
 */
const TYPES: Record<string, string> = {
  string: "текст",
  number: "тоо",
  int: "бүхэл тоо",
  bigint: "тоо",
  boolean: "тийм/үгүй",
  date: "огноо",
  array: "жагсаалт",
  tuple: "жагсаалт",
  set: "жагсаалт",
  object: "утга",
  record: "утга",
  map: "утга",
  symbol: "утга",
  never: "утга",
  void: "утга",
  undefined: "хоосон",
  null: "хоосон",
  nan: "тоо биш утга",
};

function sizing(origin: string | undefined) {
  return UNITS[origin ?? ""] ?? null;
}

function quote(value: unknown): string {
  return typeof value === "string" ? `«${value}»` : String(value);
}

export function mongolianErrorMap(): { localeError: z.core.$ZodErrorMap } {
  const localeError: z.core.$ZodErrorMap = (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        /*
         * ★ `undefined` is the overwhelmingly common case and it is not a type
         * problem to the person reading it — it is an empty required field.
         * Saying "expected текст, received хоосон" for a blank input is how a
         * form ends up explaining its own schema to a parent.
         */
        if (issue.input === undefined || issue.input === null) {
          return "Энэ талбарыг бөглөнө үү.";
        }
        const expected = TYPES[String(issue.expected)] ?? String(issue.expected);
        return `${expected} оруулна уу.`;
      }

      case "invalid_value": {
        if (issue.values.length === 1) {
          return `${quote(issue.values[0])} байх ёстой.`;
        }
        return "Жагсаалтаас нэгийг сонгоно уу.";
      }

      case "too_small": {
        const unit = sizing(issue.origin);
        const min = issue.minimum.toString();

        /*
         * ★ `min(1)` is "fill this in", not "at least 1 character". It is the
         * most common constraint in the product and the literal translation is
         * the least useful sentence available for it.
         */
        if (unit && unit.one && min === "1" && issue.inclusive) {
          return "Энэ талбарыг бөглөнө үү.";
        }

        if (unit && unit.one) {
          return issue.inclusive
            ? `Хамгийн багадаа ${min} ${unit.ablative} бүрдэх ёстой.`
            : `${min} ${unit.ablative} урт байх ёстой.`;
        }

        return issue.inclusive ? `${min}-аас багагүй байх ёстой.` : `${min}-аас их байх ёстой.`;
      }

      case "too_big": {
        const unit = sizing(issue.origin);
        const max = issue.maximum.toString();

        if (unit && unit.one) {
          return issue.inclusive
            ? `Хамгийн ихдээ ${max} ${unit.ablative} бүрдэх ёстой.`
            : `${max} ${unit.ablative} богино байх ёстой.`;
        }

        return issue.inclusive ? `${max}-аас ихгүй байх ёстой.` : `${max}-аас бага байх ёстой.`;
      }

      case "invalid_format": {
        const formatIssue = issue as typeof issue & {
          format: string;
          prefix?: string;
          suffix?: string;
          includes?: string;
        };

        if (formatIssue.format === "starts_with") {
          return `${quote(formatIssue.prefix)}-аар эхлэх ёстой.`;
        }
        if (formatIssue.format === "ends_with") {
          return `${quote(formatIssue.suffix)}-аар төгсөх ёстой.`;
        }
        if (formatIssue.format === "includes") {
          return `${quote(formatIssue.includes)} агуулсан байх ёстой.`;
        }

        return `${FORMATS[formatIssue.format] ?? formatIssue.format} буруу байна.`;
      }

      case "not_multiple_of":
        return `${issue.divisor}-д хуваагдах ёстой.`;

      /*
       * ★ These three are contract failures rather than user mistakes — a
       * client sent a shape the API does not model. They are translated
       * anyway, because "which of these is user-facing" is not a judgement
       * this file can make correctly for every future caller, and an English
       * sentence surfacing on a screen is the thing being fixed.
       */
      case "unrecognized_keys":
        return `Танигдахгүй талбар: ${issue.keys.join(", ")}`;

      case "invalid_key":
        return "Талбарын нэр буруу байна.";

      case "invalid_element":
        return "Жагсаалтад буруу утга байна.";

      case "invalid_union":
        return "Оруулсан мэдээлэл буруу байна.";

      default:
        return "Оруулсан мэдээлэл буруу байна.";
    }
  };

  return { localeError };
}
