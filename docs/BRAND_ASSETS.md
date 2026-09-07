# Brand assets

Every brand image in `apps/web` is derived from one committed source:

```text
docs/spikes/pdf/assets/photo-9.jpg    1400 x 1400, JPEG, off-white ground
```

The supplied off-white background is part of the approved artwork. The full
logo, browser icons, Apple icon, and PWA icons must remain opaque. Do not
background-remove or trim the canonical image.

## Outputs

| File | Size | Ground | Purpose |
| --- | --- | --- | --- |
| `app/favicon.ico` | 48, 32, 16 | artwork ground | Browser and crawler fallback icon |
| `app/icon.png` | 512 x 512 | artwork ground | Next.js browser icon |
| `app/apple-icon.png` | 180 x 180 | artwork ground | iOS home-screen icon |
| `public/icons/pwa-192.png` | 192 x 192 | artwork ground | Manifest `any` icon |
| `public/icons/pwa-512.png` | 512 x 512 | artwork ground | Manifest `any` icon |
| `public/icons/pwa-maskable-512.png` | 512 x 512 | artwork ground | Android maskable safe-zone icon |
| `public/logo.png` | 1400 x 1400 | artwork ground | Exact supplied logo used by auth screens |
| `public/mark.png` | 512 x 373 | transparent | Compact wordmark-free sidebar mark |

The compact `mark.png` is the only transparent derivation. It is used where the
product name is rendered beside the image; using the full drawn wordmark there
would repeat the name.

## Regeneration

Run from `apps/web`:

```bash
SRC=../../docs/spikes/pdf/assets/photo-9.jpg

# Canonical logo: preserve every source pixel, including the background.
magick "$SRC" -strip PNG24:public/logo.png

magick "$SRC" -resize 512x512 -strip PNG24:app/icon.png
magick "$SRC" -resize 180x180 -strip PNG24:app/apple-icon.png
magick "$SRC" -resize 192x192 -strip PNG24:public/icons/pwa-192.png
magick "$SRC" -resize 512x512 -strip PNG24:public/icons/pwa-512.png

# Keep the complete logo inside Android's maskable safe zone.
magick "$SRC" -resize 358x358 -background '#f5f4f2' -gravity center \
  -extent 512x512 -strip PNG24:public/icons/pwa-maskable-512.png

# The favicon contains the same full, opaque artwork at three sizes.
magick "$SRC" \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 32x32 \) \
  \( -clone 0 -resize 16x16 \) -delete 0 app/favicon.ico
```

`favicon.ico`, `icon.png`, and `apple-icon.png` are Next.js file conventions;
do not also declare them in `metadata.icons`. The PWA variants are declared in
`app/manifest.ts`.

`opengraph-image.png` is a separate 1200 x 630 share-card composition.
`opengraph-image.alt.txt` must be updated whenever that composition changes.
