ARG NODE_IMAGE=crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang/node:24.18.1-bookworm-slim
ARG PI_VERSION=0.83.0

FROM ${NODE_IMAGE} AS dependencies
ARG PI_VERSION
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fd-find git ripgrep \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION}
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/editor/package.json packages/editor/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/draft-template/package.json packages/draft-template/package.json
RUN npm ci --no-audit --no-fund

FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 4173
CMD ["npm", "run", "dev"]

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/editor/package.json packages/editor/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/draft-template/package.json packages/draft-template/package.json
RUN npm ci --omit=dev --omit=optional --workspace @draftly/server --include-workspace-root=false --no-audit --no-fund

FROM ${NODE_IMAGE} AS production
ARG PI_VERSION
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fd-find git ripgrep \
  && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION}
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder --chown=node:node /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=node:node /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=builder --chown=node:node /app/packages/editor/dist ./packages/editor/dist
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /app/packages/shared/src ./packages/shared/src
COPY --from=builder --chown=node:node /app/packages/shared/component-registry.json ./packages/shared/component-registry.json
COPY --from=builder --chown=node:node /app/packages/draft-template ./packages/draft-template
RUN mkdir -p /var/lib/draftly/workspaces && chown -R node:node /var/lib/draftly
USER node
EXPOSE 4173
CMD ["node", "packages/server/dist/dev.js"]
