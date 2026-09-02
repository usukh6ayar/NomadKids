# Brand assets

Every brand image in `apps/web` is derived from **one** file:

```
../ByatshanNuudelchid/assets/logo.jpeg      1254 × 1254, JPEG, off-white ground
```

★ That path is **outside this repository and outside the Docker build context.**
Nothing in the tree may reference it: the VPS builds `apps/web` from a context
that has no sibling directory, and a build step reaching for it would fail there
and nowhere else. The derived files are committed; the source is not.

This document exists so the provenance survives. `logo-160.png` and
`mark-96.png` shipped for three weeks with no record of where their pixels came
from, and the only thing anyone could do with them was scale them down.

## The two derivations

The source is a JPEG on a light ground (~`#f6f5f3`) with compression ringing at
the edges, so the background is flood-filled to transparent with a fuzz
tolerance rather than keyed on an exact colour.

```bash
SRC=../ByatshanNuudelchid/assets/logo.jpeg

# full — the whole logo, wordmark included
magick "$SRC" -alpha set -fuzz 10% -fill none -draw "color 2,2 floodfill" \
  -trim +repage full.png                                  # 1071 × 1149

# mark — the arc, the soyombo and the two faces, wordmark cropped off
magick full.png -crop 1071x746+0+0 +repage -trim +repage mark.png   # 1024 × 746
```

★ **746 is not a round number and must not be rounded.** The children's chins
sit directly on the tops of `БЯЦХАН` — there is no gap. A crop at 790 takes the
letter tops with it; one at 700 cuts the chins off.

★★ **The wordmark is cropped out of every icon.** At 16 px — the size that
actually appears in a browser tab — `БЯЦХАН НҮҮДЭЛЧИД` is four grey smudges.
The arc and the two faces still read as this product. The full logo appears in
exactly one generated file, `opengraph-image.png`, which is never rendered below
600 px wide.

## What is generated, and why each one differs

| File                                | Size        | Ground             | Why                                                                                                                                                                                                          |
| ----------------------------------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/favicon.ico`                   | 48, 32, 16  | transparent        | The URL crawlers, feed readers and old browsers request without being told to. Next's middleware matcher already names it                                                                                    |
| `app/icon.png`                      | 512²        | transparent        | `<link rel="icon">`. Transparent so it reads on a light **and** a dark tab strip — the mark's own blue and yellow carry it either way                                                                        |
| `app/apple-icon.png`                | 180²        | **opaque white**   | iOS composites alpha onto black. A transparent apple-touch-icon is a black tile with two faces floating in it                                                                                                |
| `app/opengraph-image.png`           | 1200 × 630  | white on `#eff6ff` | Link previews. The one place the wordmark belongs                                                                                                                                                            |
| `public/icons/pwa-192.png`          | 192²        | opaque white       | manifest, `purpose: "any"`                                                                                                                                                                                   |
| `public/icons/pwa-512.png`          | 512²        | opaque white       | manifest, `purpose: "any"`                                                                                                                                                                                   |
| `public/icons/pwa-maskable-512.png` | 512²        | opaque white       | manifest, `purpose: "maskable"` — **the mark is drawn at 70% width**, inside the safe zone an Android launcher's circular crop leaves. The `any` icons fill their square and would lose both ends of the arc |
| `public/logo.png`                   | 1071 × 1149 | transparent        | The auth screen's panel                                                                                                                                                                                      |
| `public/mark.png`                   | 512 × 373   | transparent        | The sidebar tile                                                                                                                                                                                             |

The OpenGraph type is set in `app/layout.tsx`; the manifest in `app/manifest.ts`.
Neither lists the icon files — `favicon.ico`, `icon.png` and `apple-icon.png` are
Next **file conventions**, so Next reads their real dimensions and emits the
`<link>` tags itself. Declaring them in `metadata.icons` as well emits each tag
twice.

## Compression

Every PNG is quantised to a 256-colour palette with Floyd–Steinberg dithering:

```bash
magick in.png -dither FloydSteinberg -colors 256 \
  -strip -define png:compression-level=9 PNG8:out.png
```

`logo.png` goes from 728 KB to 254 KB this way, at an RMSE of 2.1% — invisible
at any size the file is displayed at, checked against the truecolour original on
both a white and a `#1e293b` ground before it was accepted. Alpha survives:
`PNG8` here means `PaletteAlpha`, per-entry transparency in a `tRNS` chunk, not
a 1-bit threshold, so the anti-aliased edges do not go jagged.

☆ The existing `public/icons/icon-*.png` (400–800 KB apiece) have **not** been
put through this. They are illustrations, not brand assets, and are out of this
change's scope — but they are the largest static payload the product ships and
worth a pass of their own.
