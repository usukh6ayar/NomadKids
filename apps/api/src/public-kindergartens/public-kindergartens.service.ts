import { Injectable } from "@nestjs/common";
import {
  locationStem,
  normalizeKindergartenName,
  type PublicKindergarten,
} from "@kinder/contracts";
import { PublicKindergartensRepository } from "./public-kindergartens.repository";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The contracted kindergartens a stranger may see — names only (#211).
 *
 * Shared by the sign-up dialog's list, staff registration by kindergarten id,
 * and the solo sign-up's refusal, so all three agree on what "a contracted
 * kindergarten" is.
 */
@Injectable()
export class PublicKindergartensService {
  constructor(private readonly repo: PublicKindergartensRepository) {}

  async listInLocation(location: string): Promise<PublicKindergarten[]> {
    const stem = locationStem(location);
    if (stem.length < 2) return [];
    return this.repo.listContractedIn(stem);
  }

  /**
   * The kindergarten id staff registration may use, or null. A malformed id
   * is null too — never a database error a caller could tell apart.
   */
  async contractedId(id: string): Promise<string | null> {
    if (!UUID.test(id)) return null;
    return (await this.repo.findContracted(id))?.id ?? null;
  }

  /**
   * The contracted kindergarten in this district whose name is the one typed,
   * once both are normalised — what refuses a solo sign-up (#211 item 3).
   *
   * ★ Equal names only, not the web's "one contains the other". The warning
   * on the form can afford to be loose; a refusal cannot, or «Нар» would
   * shut out a teacher at «Наран» because «Нарлаг» signed.
   */
  async findSameNamed(location: string, typedName: string): Promise<PublicKindergarten | null> {
    const typed = normalizeKindergartenName(typedName);
    if (typed.length < 3) return null;
    const listed = await this.listInLocation(location);
    return listed.find((k) => normalizeKindergartenName(k.name) === typed) ?? null;
  }
}
