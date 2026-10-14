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
