FROM oven/bun AS builder

WORKDIR /app

ARG PUB_ENV
ARG PUB_HOSTNAME
ARG PUB_PLAUSIBLE_URL
ARG PUB_VERTD_URL
ARG PUB_DISABLE_ALL_EXTERNAL_REQUESTS
ARG PUB_DONATION_URL
ARG PUB_STRIPE_KEY
ARG PUB_DISABLE_FAILURE_BLOCKS=false

ENV PUB_ENV=${PUB_ENV}
ENV PUB_HOSTNAME=${PUB_HOSTNAME}
ENV PUB_PLAUSIBLE_URL=${PUB_PLAUSIBLE_URL}
ENV PUB_VERTD_URL=${PUB_VERTD_URL}
ENV PUB_DISABLE_ALL_EXTERNAL_REQUESTS=${PUB_DISABLE_ALL_EXTERNAL_REQUESTS}
ENV PUB_DONATION_URL=${PUB_DONATION_URL}
ENV PUB_STRIPE_KEY=${PUB_STRIPE_KEY}
ENV PUB_DISABLE_FAILURE_BLOCKS=${PUB_DISABLE_FAILURE_BLOCKS}

COPY package.json bun.lock ./

RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# postinstall copies mupdf-wasm.wasm into static/; create it before install.
RUN mkdir -p static

RUN bun install --frozen-lockfile

COPY . ./

RUN bun run build

# nginx stable, kept patched to reduce known High-severity CVEs in shipped
# libs (issue #243). The base image is rebuilt with an `apk upgrade`.
FROM nginx:stable-alpine

RUN apk add --no-cache --upgrade iproute2 && \
    rm -rf /var/cache/apk/*

EXPOSE 80/tcp

COPY ./nginx/default.conf.template /etc/nginx/conf.d/default.conf
COPY ./docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh

COPY --from=builder /app/build /usr/share/nginx/html

# Run as non-root (the alpine image provides the `nginx` user).
RUN chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/conf.d /var/cache/nginx /var/run && \
    sed -i 's/^user  nginx;$/user  nginx;/' /etc/nginx/nginx.conf

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl --fail --silent --output /dev/null http://localhost || exit 1

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
CMD ["nginx", "-g", "daemon off;"]
