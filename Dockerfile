ARG HUGO_VERSION=0.157.0

FROM floryn90/hugo:${HUGO_VERSION}-ext AS builder

WORKDIR /src

COPY . .

RUN hugo --minify --gc --cleanDestinationDir

FROM nginx:1.27-alpine

COPY --from=builder /src/public/ /usr/share/nginx/html/
