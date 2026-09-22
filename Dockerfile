# syntax=docker/dockerfile:1
#
# Model Lab — one container: Next.js server + native runner + headless Chromium.
#
# Built on the official Node image plus exactly the browser the checks use:
# The hash-pinned Chrome for Testing headless shell in browser-runtime.json,
# with its system libraries. (The full Playwright base image ships three
# browsers and weighs about 4 GB; this one is a fraction of that.)
#
#   docker build -t model-lab .
#   docker run --rm -p 127.0.0.1:3000:3000 -v model-lab-data:/data \
#     -e MODEL_LAB_MOCK_PROVIDERS=1 -e MODEL_LAB_READ_ONLY=1 model-lab
#
# See docs/DEPLOY.md for the two deployment profiles.

# Official Node multi-platform index, resolved from Docker Hub on 2026-09-18.
# Update the digest deliberately and rerun the Linux image check.
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS expat-build
# Debian 13 has no Expat 2.8.4 package yet. Build the unmodified, verified
# upstream release as a real same-ABI Debian package; build tools stay here.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends build-essential cmake xz-utils dpkg-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
ADD --checksum=sha256:656ae1cc8da3b4ea513bb4e254f33e6243938084c0ec6239da873376b09985a7 https://github.com/libexpat/libexpat/releases/download/R_2_8_4/expat-2.8.4.tar.xz /build/expat-2.8.4.tar.xz
COPY scripts/container/build-package.sh scripts/container/verify-expat.c ./
RUN sh build-package.sh

FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS base
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/opt/corepack \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
FROM base AS build
# Manifests first so the install layer survives source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/store/package.json packages/store/
COPY runners/build-arena/package.json runners/build-arena/
RUN pnpm install --frozen-lockfile
COPY . .
# The build never talks to a provider: keys are absent and mocks are forced.
RUN MODEL_LAB_MOCK_PROVIDERS=1 MODEL_LAB_STORE=memory pnpm build
# pnpm prune does not recursively prune workspaces. Reinstall the production
# graph from the verified build store, preserving workspace links and the CLI.
# This happens before runtime COPY: dev packages never enter published layers.
# tsx runs the source CLI; TypeScript loads next.config.ts at server startup.
RUN rm -rf node_modules apps/web/node_modules packages/schemas/node_modules \
    packages/store/node_modules runners/build-arena/node_modules \
  && pnpm install --prod --frozen-lockfile --offline
# No route uses next/image. Check the built config, then remove unused native
# decoders before COPY so their binaries never enter any runtime image layer.
RUN node scripts/remove_unused_image_optimizer.mjs

# ---------------------------------------------------------------------------
FROM base AS runtime
ARG MODEL_LAB_SOURCE_REVISION=
ARG MODEL_LAB_SOURCE_DIRTY=1
ARG MODEL_LAB_SOURCE_URL=https://github.com/hugosmoreira/model-lab
LABEL org.opencontainers.image.source=$MODEL_LAB_SOURCE_URL \
    org.opencontainers.image.revision=$MODEL_LAB_SOURCE_REVISION \
    org.opencontainers.image.licenses=MIT
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MODEL_LAB_DATA_DIR=/data \
    MODEL_LAB_STORE=sqlite \
    MODEL_LAB_SQLITE_PATH=/data/model-lab.db \
    MODEL_LAB_SOURCE_REVISION=$MODEL_LAB_SOURCE_REVISION \
    MODEL_LAB_SOURCE_DIRTY=$MODEL_LAB_SOURCE_DIRTY
COPY --from=build /app /app
# Install the browser using the exact build-time package manager, then remove
# installer tooling from the runtime. The direct CLI below needs only Node.
COPY --from=build /opt/corepack /opt/corepack
# Install the supported system libraries and the separately security-pinned
# browser. Playwright's bundled browser can lag published security patches.
# Install the patched parser in this same layer: no vulnerable Expat binary is
# retained in a lower runtime layer. Keep the required GBM/Mesa dependency chain.
RUN --mount=from=expat-build,source=/out,target=/expat-package \
  pnpm --filter @model-lab/build-arena-runner exec playwright install-deps chromium \
  && pnpm browser:install \
  && apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get upgrade --yes \
  && dpkg -i /expat-package/libexpat1_2.8.4-0modellab1_amd64.deb \
  && ldconfig \
  && timeout 10 /expat-package/verify-expat \
  && apt-get purge --yes xvfb xserver-common \
  && apt-get autoremove --purge --yes \
  && find /usr -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} + \
  && rm -rf /var/lib/apt/lists/* /root/.cache \
    /opt/corepack /opt/yarn-* /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
# Debian slim's dpkg filters omit non-copyright documentation. Explicitly retain
# the verified local package's source provenance, recipe and changelog as well.
COPY --from=expat-build /package/usr/share/doc/libexpat1/ /usr/share/doc/libexpat1/
COPY --chmod=0555 scripts/model-lab-container /usr/local/bin/model-lab
RUN mkdir -p /data /app/apps/web/.next/cache \
  && chown node:node /data /app/apps/web/.next/cache
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/store').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Start Node directly so signals reach the server and startup needs no package
# manager download. Published deployments should also pass Docker's --init.
# Next's TypeScript config loader resolves local imports from the app cwd.
WORKDIR /app/apps/web
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
