# Etapa de compilación
FROM rust:1-bookworm AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
COPY seed_bootstrap.json ./

RUN cargo build --release --locked

# Etapa de ejecución minimalista
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin vertika

COPY --from=builder /app/target/release/vertika-backend /usr/local/bin/vertika-backend

USER vertika
ENV PORT=8080
EXPOSE 8080

CMD ["vertika-backend"]
