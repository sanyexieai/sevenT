ARG CUDA_RUNTIME_IMAGE=nvidia/cuda:13.1.1-runtime-ubuntu24.04
FROM ubuntu:24.04 AS runtime-cpu

WORKDIR /app

RUN sed -i 's|http://archive.ubuntu.com/ubuntu|http://mirrors.ustc.edu.cn/ubuntu|g; s|http://security.ubuntu.com/ubuntu|http://mirrors.ustc.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || \
      sed -i 's|http://archive.ubuntu.com/ubuntu|http://mirrors.ustc.edu.cn/ubuntu|g; s|http://security.ubuntu.com/ubuntu|http://mirrors.ustc.edu.cn/ubuntu|g' /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 libstdc++6 \
    && mkdir -p /logs \
    && rm -rf /var/lib/apt/lists/*

COPY .dist/nas-nllb-service-cpu /usr/local/bin/nas-nllb-service

ENV APP_BIND=0.0.0.0:8080
ENV MODEL_DIR=/models/nllb-200-distilled-600M
ENV REQUEST_LOG_PATH=/logs/requests.jsonl
ENV DEFAULT_SOURCE_LANG=eng_Latn
ENV DEFAULT_TARGET_LANG=zho_Hans
ENV CT2_DEVICE=cpu
ENV CT2_COMPUTE_TYPE=auto
ENV CT2_THREADS=0
ENV TRANSLATION_BEAM_SIZE=4
ENV TRANSLATION_MAX_INPUT_LENGTH=512
ENV TRANSLATION_MAX_DECODING_LENGTH=256

EXPOSE 8080

CMD ["nas-nllb-service"]

FROM ${CUDA_RUNTIME_IMAGE} AS runtime-gpu

WORKDIR /app

RUN mkdir -p /logs

COPY .dist/nas-nllb-service-gpu /usr/local/bin/nas-nllb-service

ENV APP_BIND=0.0.0.0:8080
ENV MODEL_DIR=/models/nllb-200-distilled-600M
ENV REQUEST_LOG_PATH=/logs/requests.jsonl
ENV DEFAULT_SOURCE_LANG=eng_Latn
ENV DEFAULT_TARGET_LANG=zho_Hans
ENV CT2_DEVICE=auto
ENV CT2_COMPUTE_TYPE=auto
ENV CT2_THREADS=0
ENV TRANSLATION_BEAM_SIZE=4
ENV TRANSLATION_MAX_INPUT_LENGTH=512
ENV TRANSLATION_MAX_DECODING_LENGTH=256

EXPOSE 8080

CMD ["nas-nllb-service"]
