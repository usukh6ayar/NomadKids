import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The kindergarten-side half of staff self-registration: the director's
 * registration code.
 *
 * ★ Separate from `EsisRepository` on purpose. `EsisStaffRoster` is filled
 * from a live ESIS read and belongs with the integration that produces it;
 * this code never touches ESIS — it is a column on `Kindergarten` that gates
 * who may attempt a match against that roster. Task 5 (`POST
 * /v1/staff-registration`, the public route that verifies a submitted code)
 * reads the hash this repository writes, which is why the verification
 * lookup belongs beside the write rather than in a third place.
 */
@Injectable()
export class StaffRegistrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findKindergarten(id: string) {
    return this.prisma.kindergarten.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Rotates the kindergarten's registration code hash.
   *
   * ★ Unconditional overwrite. There is no "current code" to compare against —
   * issuing a new one always replaces whatever was there, which is what makes
   * rotation meaningful: a code shown once and then compromised is invalidated
   * simply by asking for another.
   */
  setRegistrationCodeHash(kindergartenId: string, hash: string, setAt: Date) {
    return this.prisma.kindergarten.update({
      where: { id: kindergartenId },
      data: { staffRegistrationCodeHash: hash, staffRegistrationCodeSetAt: setAt },
    });
  }
}
