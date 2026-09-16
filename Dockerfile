# syntax=docker/dockerfile:1
#
# Model Lab — one container: Next.js server + native runner + headless Chromium.
#
# Built on the official Node image plus exactly the browser the checks use:
# Playwright's headless Chromium shell for the version pinned in pnpm-lock.yaml,
# with its system libraries. (The full Playwright base image ships three
# browsers and weighs about 4 GB; this one is a fraction of that.)
#
#   docker build -t model-lab .
#   docker run --rm -p 3000:3000 -v model-lab-data:/data \
#     -e MODEL_LAB_MOCK_PROVIDERS=1 -e MODEL_LAB_READ_ONLY=1 model-lab
#
# See docs/DEPLOY.md for the two deployment profiles.

FROM node:22-bookworm-slim AS base
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
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
# Dev dependencies stay: `pnpm prune --prod` drops the workspace's bin links
# (next itself), and they are small next to the browser.

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MODEL_LAB_DATA_DIR=/data \
    MODEL_LAB_STORE=sqlite \
    MODEL_LAB_SQLITE_PATH=/data/model-lab.db
COPY --from=build /app /app
# The browser the checks launch (headless: true → the headless shell), at the
# exact version the playwright package expects, plus its system libraries.
RUN pnpm --filter @model-lab/build-arena-runner exec playwright install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* /root/.cache
RUN mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/store').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@model-lab/web", "start"]
