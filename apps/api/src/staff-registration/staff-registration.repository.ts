import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * The kindergarten-side half of staff self-registration.
 *
 * ★ Separate from `EsisRepository` on purpose. `EsisStaffRoster` is filled
 * from a live ESIS read and belongs with the integration that produces it;
 * nothing here touches ESIS — `esisInstitutionId` is a column on
 * `Kindergarten`, and this repository only reads it to decide **whose**
 * roster a public attempt is allowed to be matched against.
 */
@Injectable()
export class StaffRegistrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findKindergarten(id: string) {
    return this.prisma.kindergarten.findFirst({ where: { id, deletedAt: null } });
  }

  /**
   * Which kindergarten a submitted ESIS institution number names.
   *
   * ★ One indexed lookup, where this used to be a loop over every stored code
   * hash. `Kindergarten.esisInstitutionId` is `@unique`, so this is exact and
   * cannot return two.
   *
   * ★★ It returns only the id. A caller that could see the name would learn
   * that the number exists, and `StaffRegistrationService.REFUSAL` spends a
   * great deal of care making sure no branch of the public route tells a
   * caller anything they did not already submit.
   */
  findKindergartenIdByEsisInstitutionId(esisInstitutionId: string) {
    return this.prisma.kindergarten.findFirst({
      where: { esisInstitutionId, deletedAt: null },
      select: { id: true },
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
