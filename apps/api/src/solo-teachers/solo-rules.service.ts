import { localDate } from "@kinder/contracts";
import { BadRequestException, Injectable } from "@nestjs/common";
import { SoloRulesRepository } from "./solo-rules.repository";

/**
 * What a solo teacher's workspace allows (the user, 2026-10-11): **parents
 * only** besides the teacher, and **one group** a school year.
 *
 * ★ Not decoration. The teacher holds TEACHER only here since 2026-10-14, so
 * inviting staff is not open to them; adding a group is (they set up their
 * own, 2026-10-14) and is exactly what the one-group rule holds. A workspace
 * that ever gains an administrator (an old ADMIN row) must still keep both
 * rules, or it runs a whole kindergarten without its contract. Called by every path
 * that adds a person to a kindergarten or a group to it — `UsersService` and
 * `TenantsService` — and a contracted kindergarten is never affected.
 *
 * 400, not 404: the actor has already passed the authorization check; the
 * refusal is a rule, not a secret.
 */
@Injectable()
export class SoloRulesService {
  constructor(private readonly repo: SoloRulesRepository) {}

  async assertRoleAllowed(kindergartenId: string, role: string): Promise<void> {
    if (role === "PARENT") return;
    if ((await this.repo.kindOf(kindergartenId)) === "SOLO_TEACHER") {
      throw new BadRequestException("Бие даасан багшийн орчинд зөвхөн эцэг эхийг урина.");
    }
  }

  /** Whether this is a solo teacher's workspace. */
  async isSolo(kindergartenId: string): Promise<boolean> {
    return (await this.repo.kindOf(kindergartenId)) === "SOLO_TEACHER";
  }

  /**
   * ★ This year and the next, no more (the user, 2026-10-16). One group per
   * year is only a limit if the years are: with no cap, a teacher opened
   * «2026-2027», «2026-2027 Б», … and ran a group in each at once — a whole
   * kindergarten without its contract. Two open years leave room to set up
   * September's group before June's ends.
   */
  async assertCanAddSchoolYear(kindergartenId: string): Promise<void> {
    if (!(await this.isSolo(kindergartenId))) return;
    const today = new Date(`${localDate()}T00:00:00.000Z`);
    if ((await this.repo.countOpenSchoolYears(kindergartenId, today)) >= 2) {
      throw new BadRequestException(
        "Бие даасан багш энэ болон дараагийн хичээлийн жилтэй ажиллана. Дууссан жил дуусахыг хүлээнэ үү.",
      );
    }
  }

  /**
   * ★ One group **per school year** (the user, 2026-10-14: the teacher sets up
   * their own year and group). Next year's group sits beside this year's until
   * the children move up and the old one is archived — one at a time is what
   * "1 багш 1 бүлэг" means, not one ever.
   */
  async assertCanAddGroup(kindergartenId: string, schoolYearId: string): Promise<void> {
    if ((await this.repo.kindOf(kindergartenId)) !== "SOLO_TEACHER") return;
    if ((await this.repo.countLiveGroups(kindergartenId, schoolYearId)) >= 1) {
      throw new BadRequestException("Бие даасан багш нэг хичээлийн жилд нэг бүлэгтэй ажиллана.");
    }
  }
}
