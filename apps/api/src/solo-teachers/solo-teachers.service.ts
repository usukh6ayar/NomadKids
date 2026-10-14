import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { TeacherSignup, TeacherSignupResult } from "@kinder/contracts";
import { randomBytes } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { PublicKindergartensService } from "../public-kindergartens/public-kindergartens.service";
import { PasswordService, validatePasswordStrength } from "../auth/password.service";
import {
  PhoneVerificationService,
  type PhoneVerificationStart,
} from "../phone-verification/phone-verification.service";
import { SoloTeachersRepository } from "./solo-teachers.repository";

/**
 * A teacher signing up alone (#195; the user, 2026-10-11): no ESIS code, no
 * approval — they start at once in a workspace of their own.
 *
 * ★ One window (the user, 2026-10-14). The form carries the password and,
 * where verify.mn is on, the proof of the phone; the account is usable the
 * moment this answers. It used to answer an invitation token and send the
 * teacher to `/invitation/[token]`, which asked for them a second time. Tokens
 * issued before then still work there — that path is untouched.
 *
 * ★★ The username is generated, never derived from the form. They sign in
 * with their phone (`loginSchema.identifier` takes either) and can choose a
 * username later.
 */
@Injectable()
export class SoloTeachersService {
  constructor(
    private readonly repo: SoloTeachersRepository,
    private readonly passwords: PasswordService,
    private readonly phones: PhoneVerificationService,
    private readonly audit: AuditRepository,
    private readonly publicKindergartens: PublicKindergartensService,
  ) {}

  /**
   * The SMS for the sign-up form's phone. A number an account already holds is
   * refused here, before the person pays for a text — the sign-up itself says
   * the same, so this tells nobody anything new.
   */
  async startPhoneVerification(phone: string, ip: string | null): Promise<PhoneVerificationStart> {
    if ((await this.repo.contactTaken(null, phone)) === "phone") {
      throw new ConflictException("Энэ утасны дугаар аль хэдийн бүртгэлтэй байна");
    }
    return this.phones.start("SIGNUP", phone, null, ip);
  }

  async signup(dto: TeacherSignup, ip: string | null): Promise<TeacherSignupResult> {
    // ★ A teacher whose kindergarten has signed joins it, not a workspace of
    // their own beside it (#211 item 3). Equal names in the same district
    // only — `findSameNamed`; the form's own warning is looser.
    if (dto.location && dto.kindergartenName) {
      const contracted = await this.publicKindergartens.findSameNamed(
        dto.location,
        dto.kindergartenName,
      );
      if (contracted) {
        throw new ConflictException(
          `«${contracted.name}» NomadKids-тэй гэрээтэй. «Цэцэрлэгээр» хэсгээс бүртгүүлнэ үү.`,
        );
      }
    }

    const taken = await this.repo.contactTaken(dto.email, dto.phone);
    if (taken === "email") throw new ConflictException("Энэ и-мэйл аль хэдийн бүртгэлтэй байна");
    if (taken === "phone") {
      throw new ConflictException("Энэ утасны дугаар аль хэдийн бүртгэлтэй байна");
    }

    const weaknesses = validatePasswordStrength(dto.password);
    if (weaknesses.length > 0) throw new BadRequestException(`${weaknesses.join(". ")}.`);

    /*
     * ★ The proof is spent only after every refusal that would leave the
     * person able to try again — a taken e-mail or phone, a weak password —
     * so fixing one of those does not cost another SMS. `acceptInvitation`
     * learned the ordering from a production 500 (2026-09-19).
     */
    if (this.phones.enabled) {
      await this.phones.consume(dto.phoneVerification, { purpose: "SIGNUP", phone: dto.phone });
    }

    const { lastName, firstName } = dto;
    const display = `${Array.from(lastName)[0]!.toUpperCase()}.${firstName}`;

    // Hashing outside the transaction — argon2 takes hundreds of milliseconds.
    const passwordHash = await this.passwords.hash(dto.password);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = `teacher-${randomBytes(6).toString("base64url").toLowerCase()}`;
      if (await this.repo.usernameTaken(username)) continue;

      let created: { kindergartenId: string; userId: string };
      try {
        created = await this.repo.createWorkspace({
          kindergarten: {
            // ★ The teacher's name alone — «— бие даасан багш» was on their own
            // dashboard as its title (the user, 2026-10-14).
            name: display,
            phone: dto.phone,
            email: dto.email,
            propertyType: dto.propertyType || null,
            location: dto.location || null,
            soloWorkplaceName: dto.kindergartenName || null,
          },
          user: {
            username,
            email: dto.email,
            phone: dto.phone,
            lastName,
            firstName,
            passwordHash,
          },
        });
      } catch (error) {
        // The race past `contactTaken` above: a readable 409, never a 500.
        if (isUniqueViolation(error)) {
          throw new ConflictException("Энэ и-мэйл эсвэл утасны дугаар аль хэдийн бүртгэлтэй байна");
        }
        throw error;
      }

      await this.audit.append({
        action: "CREATE",
        kindergartenId: created.kindergartenId,
        actorLabel: `Бие даасан багшийн бүртгэл — ${display}`,
        ipAddress: ip,
        objectType: "Kindergarten",
        objectId: created.kindergartenId,
        metadata: {
          kind: "SOLO_TEACHER",
          userId: created.userId,
          workplace: dto.kindergartenName || null,
        },
      });

      return { created: true };
    }

    throw new ConflictException("Бүртгэл үүсгэж чадсангүй. Дахин оролдоно уу.");
  }
}

/** The same four lines as `auth.service.ts`'s, for the reason it gives. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
