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

★★ **The wordmark used to be cropped out of every icon, and no longer is —
client's decision, 2026-09-06.**

The technical argument for cropping was real, and is recorded here rather than
quietly dropped: at 16 px, the size that actually appears in a browser tab,
lettering is four grey smudges, while the arc and the two faces read as this
product on their own. It was put to the client with a rendered comparison of
both; they chose the full logo, background and all, everywhere.

So every icon is generated from the **square original** rather than from a
crop. The source is `docs/spikes/pdf/assets/photo-9.jpg` — 1400², lettering
included, on the artwork's own near-white ground. That it lives in a spikes
folder is historical, not deliberate; point the recipes below at a cleaner
original if one ever lands.

★★★ **The product name and the drawn lettering disagree, on purpose.**

The product is **NomadKids**; the logo says "Бяцхан нүүдэлчид". They are not
the same thing — NomadKids is the platform, that is the kindergarten it was
built for — and the client wants the drawn wordmark kept.

The cost is that no screen may set "NomadKids" in text _beside_ the drawn logo:
two names side by side read as two products. So `AuthShell` shows the logo and
no wordmark — its `alt` carries the name, which is what a screen reader
announces — and `opengraph-image.png` is the logo over the strapline. The
sidebar is the one place the name appears as text, and it uses `mark.png`, the
lettering-free crop, precisely so that the two never meet.

## What is generated, and why each one differs

| File                                | Size        | Ground             | Why                                                                                                                                                                                                          |
| ----------------------------------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/favicon.ico`                   | 48, 32, 16  | transparent        | The URL crawlers, feed readers and old browsers request without being told to. Next's middleware matcher already names it                                                                                    |
| `app/icon.png`                      | 512²        | transparent        | `<link rel="icon">`. Transparent so it reads on a light **and** a dark tab strip — the mark's own blue and yellow carry it either way                                                                        |
| `app/apple-icon.png`                | 180²        | **opaque white**   | iOS composites alpha onto black. A transparent apple-touch-icon is a black tile with two faces floating in it                                                                                                |
| `app/opengraph-image.png`           | 1200 × 630  | white on `#eff6ff` | Link previews. The full logo over the strapline — **no "NomadKids" wordmark**, which would put two names in one image                                                                                        |
| `public/icons/pwa-192.png`          | 192²        | opaque white       | manifest, `purpose: "any"`                                                                                                                                                                                   |
| `public/icons/pwa-512.png`          | 512²        | opaque white       | manifest, `purpose: "any"`                                                                                                                                                                                   |
| `public/icons/pwa-maskable-512.png` | 512²        | opaque white       | manifest, `purpose: "maskable"` — **the mark is drawn at 70% width**, inside the safe zone an Android launcher's circular crop leaves. The `any` icons fill their square and would lose both ends of the arc |
| `public/logo.png`                   | 1071 × 1149 | transparent        | The auth screen — both the card's heading and the decorative panel. Transparent, because it sits on two different grounds                                                                                    |
| `public/mark.png`                   | 512 × 373   | transparent        | The sidebar tile — **the one place with no lettering**, because the sidebar sets "NomadKids" in text beside it                                                                                               |

### Regenerating the icons

All six come from the square original, which needs no cropping — it is already
tightly framed.

```bash
cd apps/web
SRC=../../docs/spikes/pdf/assets/photo-9.jpg

magick "$SRC" -resize 512x512 -strip PNG24:app/icon.png
magick "$SRC" -resize 180x180 -strip PNG24:app/apple-icon.png
magick "$SRC" -resize 192x192 -strip PNG24:public/icons/pwa-192.png
magick "$SRC" -resize 512x512 -strip PNG24:public/icons/pwa-512.png

# maskable: 70% of the square, so an Android launcher's circular crop
# cannot take the arc's ends or the descenders with it
magick "$SRC" -resize 358x358 -background white -gravity center \
  -extent 512x512 -strip PNG24:public/icons/pwa-maskable-512.png

# favicon carries three sizes in one file
magick "$SRC" \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 16x16 \) -delete 0 app/favicon.ico
```

★ **No transparency.** The original's ground is part of what the client chose,
and an opaque icon also settles the apple-touch-icon problem for free: iOS
composites alpha onto black, so a transparent one is a black tile.

★★ Keep `opengraph-image.alt.txt` in step. It is what a screen reader announces
in place of that image, and it names both the product and the lettering.

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
