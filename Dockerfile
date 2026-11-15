# The site is static, so "build" means "copy the folder into nginx".
#
#   docker build -t earth-jukebox .
#   docker run --rm -p 8080:80 earth-jukebox
#   open http://localhost:8080/
#
# Multi-stage is not needed (nothing compiles), but an explicit copy of only the
# runtime files keeps the image small and stops .cache/ (hundreds of megabytes of
# downloaded NASA video) from leaking in.

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="The Earth Information Jukebox" \
      org.opencontainers.image.description="NASA Earth Information Center frames, read pixel by pixel and played as music." \
      org.opencontainers.image.source="https://github.com/nasa/spaceapps" \
      org.opencontainers.image.licenses="MIT"

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Only what the browser needs.
COPY index.html manifest.webmanifest 404.html og.png /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY src/ /usr/share/nginx/html/src/
COPY data/ /usr/share/nginx/html/data/
COPY audio/ /usr/share/nginx/html/audio/
COPY docs/ /usr/share/nginx/html/docs/
COPY README.md /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
