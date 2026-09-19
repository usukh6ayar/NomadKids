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

  /**
   * Every kindergarten that has ever issued a registration code.
   *
   * ★ There is no index on a hash — hashes are designed to make exactly this
   * kind of lookup impossible, which is the point of hashing the code at all.
   * `StaffRegistrationService.register` verifies a submitted code against
   * each of these in turn. See that method's doc comment for why the loop is
   * acceptable rather than a defect.
   */
  findKindergartensWithRegistrationCode() {
    return this.prisma.kindergarten.findMany({
      where: { deletedAt: null, staffRegistrationCodeHash: { not: null } },
      select: { id: true, staffRegistrationCodeHash: true },
    });
  }

  /**
   * Staff whose account was created by `register()` rather than by
   * invitation — the director's review list, Task 6.
   *
   * ★ `user.esisPersonId != null` is the marker `createInvitedAccount` never
   * sets and `createSelfRegisteredAccount` always does (Task 1's schema
   * note). No join back to `EsisStaffRoster` and no `esisPersonId` in the
   * `select` below — the screen gets a name, a role, a date and a membership
   * id, nothing the ministry would recognise as an identifier.
   *
   * ★★ `isActive: true`. `DELETE /v1/memberships/:id`
   * (`UsersRepository.deactivateMembership`) sets this false without a hard
   * delete or a `deletedAt` — CLAUDE.md §3.2's soft-delete column is for the
   * membership row itself, `isActive` is the separate "currently in effect"
   * flag `assignTeacher`/`revokeMembership` already use. A membership that
   * flag has turned off has nothing left to review, and showing it again
   * would leave a "revoke" link pointing at access that is already gone.
   */
  listSelfRegistered(kindergartenId: string, page: { skip: number; take: number }) {
    const where = {
      kindergartenId,
      isActive: true,
      deletedAt: null,
      user: { esisPersonId: { not: null } },
    };
    return Promise.all([
      this.prisma.membership.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { lastName: true, firstName: true } },
        },
      }),
      this.prisma.membership.count({ where }),
    ]);
  }
}
