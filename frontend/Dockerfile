FROM node:26.13.0-alpine AS deps
WORKDIR /app/frontend
RUN npm install -g npm@11.20.0
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts/ ./scripts/
RUN npm ci

FROM node:26.13.0-alpine AS builder
WORKDIR /app/frontend
COPY --from=deps /app/frontend/node_modules ./node_modules
COPY frontend/ .
COPY messages/ /app/messages/
# Re-run postinstall to ensure all ORT WASM + .mjs loaders are present in public/vad/
# (deps stage generates them but COPY frontend/ . above overwrites public/vad from source)
RUN node scripts/copy-vad-models.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:26.13.0-alpine AS runner
WORKDIR /app/frontend
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone /app/
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./.next/static
COPY LICENSE /app/LICENSE

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
