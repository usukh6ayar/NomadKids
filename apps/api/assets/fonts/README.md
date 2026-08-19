# Fonts

**Noto Sans** (Regular, Bold) — Google Fonts.
Licence: **SIL Open Font License 1.1**, redistributable.
Source: <https://github.com/googlefonts/noto-fonts> · `hinted/ttf/NotoSans/`

Full Cyrillic coverage, including the Mongolian-specific `Ө ө Ү ү`.

RFP §19 requires a list of licensed materials; this file is that record for the
report font.

## Why these files are committed

The spike's `Dockerfile` copies this directory into the image. A fresh clone must
be able to build it without a network fetch.

## Why they must also be installed system-wide in the image

Not merely referenced by `@font-face`. **Chromium renders no text at all — not
tofu, nothing — when fontconfig has an empty font set**, even if the page's
webfont loads correctly. The container therefore needs:

```dockerfile
COPY fonts/ /usr/share/fonts/truetype/kinder/
RUN fc-cache -f
```

Measured, with the failing and passing runs side by side, in
[`../../../PDF_SPIKE.md`](../../../PDF_SPIKE.md) §4.

The Django reference system learned the same lesson — its `assets/fonts/README.md`
carries the equivalent warning for WeasyPrint.
