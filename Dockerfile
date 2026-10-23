FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && curl -fsSL -o /tmp/postgrest.tar.xz https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-linux-static-x86-64.tar.xz \
  && tar -xJf /tmp/postgrest.tar.xz -C /usr/local/bin \
  && chmod +x /usr/local/bin/postgrest \
  && rm /tmp/postgrest.tar.xz \
  && apt-get purge -y curl xz-utils \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm install --omit=dev --prefix server
COPY server ./server
COPY web/dist ./web/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.mjs"]
