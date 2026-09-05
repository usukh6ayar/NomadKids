# docs/reference/legal — the ministry's own documents

The primary sources behind `docs/ESIS_COMPLIANCE.md` and `docs/ESIS_REQUEST.md`.
They are kept here so that a citation can be checked rather than trusted:
`ESIS_COMPLIANCE.md` quotes the requirement text **verbatim in Mongolian**, and
a verbatim quotation is only worth anything beside the thing it quotes.

| File                                                                       | What it is                                                                                                                   | Issued            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `Боловсролын_цахим_мэдээллийн_сан_бүрдүүлэх_ажиллуулах_журам_20250925.pdf` | Журам — Боловсролын цахим мэдээллийн сан бүрдүүлэх, ажиллуулах журам. Repeals **A/260**                                      | 2025-09-25, А/465 |
| `Шаардлага-шинэчлэн-батлах-тухай-А261-20241219_1.pdf`                      | Шаардлага — general requirements (35), special requirements per sector, funding sources. Repeals **111** and **370** of 2022 | 2024-12-19, А/261 |
| `BMTT-token-guide.pdf`                                                     | БМТТ — how a developer obtains an ACCESS_TOKEN on `developerv2.esis.edu.mn`                                                  | undated           |
| `ESIS_COMPLIANCE.docx`                                                     | The assessment as sent to the client. `docs/ESIS_COMPLIANCE.md` is the source of truth; this is the exported copy            | 2026-09           |

★ **Renamed 2026-09-05.** The two ministry PDFs were re-supplied under the
filenames the ministry itself publishes them as, replacing the shortened
`A465-…` / `A261-…` names. The А/465 file is byte-identical to the one it
replaced; the А/261 file is a **different scan of the same order** (same date,
same signatory, same annexes), so every verbatim quotation in
`ESIS_COMPLIANCE.md` still checks out against it.

★★ `BMTT-token-guide.pdf` was deleted in the same pass and has been restored.
Three documents cite it — `ESIS_COMPLIANCE.md`, `ESIS_API_READINESS.md` and
`REDESIGN_REPORT.md` — and it is the only evidence for the thing they assert:
that ESIS issues **one long-lived ACCESS_TOKEN per organisation**, copied by
hand, rather than a `POST /login` exchange. Without it those three become
claims with no source.

★ **A/261 cites A/465's predecessor.** Its enabling clause names Боловсролын
сайдын 2024 оны А/260, which A/465 repealed. A/465 did **not** repeal A/261, so
the requirements stand and only the citation is stale — but it is worth
confirming in writing, which `ESIS_REQUEST.md` Хавсралт 4 §13 does.

★★ **Only Хавсралт 2 §1 of A/261 applies to us.** §2 is general education and §3
is technical and vocational education — different sectors, different systems.
NomadKids is a preschool management system, so its 59 special requirements are
the ones assessed.

These are scans, roughly 12 MB together. They are tracked deliberately: the
compliance assessment is the document that gates the ESIS token, and an
assessment whose sources live in somebody's Downloads folder cannot be audited
by the next person who opens the repository.
