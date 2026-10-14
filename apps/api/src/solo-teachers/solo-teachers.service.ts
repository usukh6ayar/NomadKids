import { ConflictException, Injectable } from "@nestjs/common";
import type { TeacherSignup, TeacherSignupResult } from "@kinder/contracts";
import { randomBytes } from "node:crypto";
import { AuditRepository } from "../audit/audit.repository";
import { PublicKindergartensService } from "../public-kindergartens/public-kindergartens.service";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { SoloTeachersRepository } from "./solo-teachers.repository";

/** A week, like every other invitation. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A teacher signing up alone (#195; the user, 2026-10-11): no ESIS code, no
 * approval — they start at once in a workspace of their own.
 *
 * ★ The answer is the one-time invitation token, exactly as staff
 * self-registration answers (`/invitation/[token]` sets the password). The
 * account is unusable until then: its password hash is of random bytes nobody
 * knows. The token lives a week.
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
    private readonly tokens: TokenService,
    private readonly audit: AuditRepository,
    private readonly publicKindergartens: PublicKindergartensService,
  ) {}

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

    const [lastName, ...rest] = dto.fullName.split(/\s+/);
    const firstName = rest.join(" ") || dto.fullName;
    const family = lastName && rest.length > 0 ? lastName : "";
    const display = family ? `${Array.from(family)[0]}.${firstName}` : firstName;

    // Hashing outside the transaction — argon2 takes hundreds of milliseconds.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString("hex"));
    const { token, hash } = this.tokens.createOneTimeToken();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const username = `teacher-${randomBytes(6).toString("base64url").toLowerCase()}`;
      if (await this.repo.usernameTaken(username)) continue;

      const created = await this.repo.createWorkspace({
        kindergarten: {
          name: `${display} — бие даасан багш`,
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
          // ★ A one-word «Овог нэр» is the given name alone. The surname used
          // to repeat it, and the teacher appeared as «Сараа Сараа» (2026-10-14).
          lastName: family,
          firstName,
          passwordHash,
        },
        invitation: {
          tokenHash: hash,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          requestedIp: ip,
        },
      });

      await this.audit.append({
        action: "CREATE",
        kindergartenId: created.kindergartenId,
        actorLabel: `Бие даасан багшийн бүртгэл — ${display}`,
        objectType: "Kindergarten",
        objectId: created.kindergartenId,
        metadata: {
          kind: "SOLO_TEACHER",
          userId: created.userId,
          workplace: dto.kindergartenName || null,
        },
      });

      return { invitationToken: token };
    }

    throw new ConflictException("Бүртгэл үүсгэж чадсангүй. Дахин оролдоно уу.");
  }
}
