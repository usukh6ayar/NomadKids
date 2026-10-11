import { BadRequestException, Injectable } from "@nestjs/common";
import { SoloRulesRepository } from "./solo-rules.repository";

/**
 * What a solo teacher's workspace allows (the user, 2026-10-11): **parents
 * only** besides the teacher, and **one group**.
 *
 * ★ Not decoration. The teacher is ADMIN here and the plan is free; without
 * these two rules a teacher could invite colleagues and open groups and run a
 * whole kindergarten without its contract. Called by every path that adds a
 * person to a kindergarten or a group to it — `UsersService` and
 * `TenantsService` — and a contracted kindergarten is never affected.
 *
 * 400, not 404: the actor is the workspace's own administrator and has
 * already passed `assertAdmin`; the refusal is a rule, not a secret.
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

  async assertCanAddGroup(kindergartenId: string): Promise<void> {
    if ((await this.repo.kindOf(kindergartenId)) !== "SOLO_TEACHER") return;
    if ((await this.repo.countLiveGroups(kindergartenId)) >= 1) {
      throw new BadRequestException("Бие даасан багш нэг бүлэгтэй ажиллана.");
    }
  }
}
