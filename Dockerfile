FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=2285 GEARBOX_DATA=/data
RUN apk add --no-cache su-exec
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/gearbox-entrypoint
RUN chmod +x /usr/local/bin/gearbox-entrypoint && mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 2285
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:2285/_gearbox/api/meta >/dev/null || exit 1
# Starts as root only long enough to fix /data ownership, then runs as "node".
ENTRYPOINT ["gearbox-entrypoint"]
CMD ["node", "server.mjs"]
