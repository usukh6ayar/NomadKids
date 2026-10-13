import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** The most a district's list returns — no endpoint answers an unbounded set (§3.4). */
export const PUBLIC_KINDERGARTEN_LIMIT = 200;

/**
 * Contracted kindergartens, read by people who have no account.
 *
 * ★ `kind: CONTRACTED` is the line that matters. A solo teacher's workspace is
 * named after the teacher («Б.Сараа — бие даасан багш»), so listing one would
 * publish a person's name and that they work alone. Inactive, deleted and
 * merged kindergartens are not offered either: nobody can sign up to them.
 *
 * ★★ The district is matched against both `district` and `location`. Neither
 * is a closed list (`Kindergarten`'s «Байгууллага» fields are free text), and
 * the onboarding form asks for neither, so a director or the operator fills
 * whichever they fill. `stem` is letters, spaces and hyphens only
 * (`publicKindergartensQuerySchema`), so it carries no LIKE pattern.
 */
@Injectable()
export class PublicKindergartensRepository {
  constructor(private readonly prisma: PrismaService) {}

  private contractedIn(stem: string) {
    return {
      kind: "CONTRACTED" as const,
      isActive: true,
      deletedAt: null,
      mergedIntoId: null,
      OR: [
        { district: { startsWith: stem, mode: "insensitive" as const } },
        { location: { contains: stem, mode: "insensitive" as const } },
      ],
    };
  }

  listContractedIn(stem: string) {
    return this.prisma.kindergarten.findMany({
      where: this.contractedIn(stem),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: PUBLIC_KINDERGARTEN_LIMIT,
    });
  }

  /** Whether this id is a kindergarten staff may sign up to by choosing it. */
  findContracted(id: string) {
    return this.prisma.kindergarten.findFirst({
      where: { id, kind: "CONTRACTED", isActive: true, deletedAt: null, mergedIntoId: null },
      select: { id: true },
    });
  }
}
