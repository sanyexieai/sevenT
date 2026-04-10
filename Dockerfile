FROM rust:1.87-bookworm AS builder

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake pkg-config clang \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/nas-nllb-service /usr/local/bin/nas-nllb-service

ENV APP_BIND=0.0.0.0:8080
ENV MODEL_DIR=/models/nllb-200-distilled-600M
ENV DEFAULT_SOURCE_LANG=eng_Latn
ENV DEFAULT_TARGET_LANG=zho_Hans
ENV CT2_DEVICE=cpu
ENV CT2_COMPUTE_TYPE=default
ENV CT2_THREADS=0
ENV TRANSLATION_BEAM_SIZE=4
ENV TRANSLATION_MAX_INPUT_LENGTH=512
ENV TRANSLATION_MAX_DECODING_LENGTH=256

EXPOSE 8080

CMD ["nas-nllb-service"]
