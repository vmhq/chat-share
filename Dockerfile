# ---------- Build stage ----------
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .

# ---------- Runtime stage ----------
FROM oven/bun:1-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "run", "src/index.ts"]
