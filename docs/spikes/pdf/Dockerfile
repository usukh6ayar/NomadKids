# Reproduces the deployment target for the PDF spike: a minimal Linux image
# with Chromium and NO Cyrillic system fonts. The absence of fonts is
# deliberate — it is the condition under which Mongolian silently becomes
# tofu, and the whole point is to find that on a laptop rather than in
# production.
#
# Chromium comes from the Debian archive rather than Puppeteer's bundled
# download so the image works on both arm64 (this laptop) and amd64
# (Railway/Fly).

FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /spike
COPY package.json ./
RUN npm install puppeteer unpdf --no-audit --no-fund

COPY content.mjs verify.mjs run-docker.mjs ./
COPY fonts ./fonts
COPY assets ./assets
RUN mkdir -p out

CMD ["node", "run-docker.mjs"]
