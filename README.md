# NAS NLLB Service

一个面向 NAS/家庭服务器部署的 `Rust + Axum + ct2rs + NLLB-600M` 项目骨架。

特点：

- `Axum` HTTP API，直接提供翻译服务
- `ct2rs` 驱动 CTranslate2 推理
- 面向 Docker / NAS 的目录约定，模型目录挂载即可运行
- 保留 `NLLB-200 distilled 600M` 的默认语言码配置

## 目录约定

```text
.
├─ src/
├─ models/
│  └─ nllb-200-distilled-600M/
├─ data/
├─ compose.yaml
└─ Dockerfile
```

## 1. 准备模型

`ct2rs` 文档给出的 NLLB 转换示例是：

```bash
pip install ctranslate2 huggingface_hub torch transformers
ct2-transformers-converter --model facebook/nllb-200-distilled-600M \
  --output_dir models/nllb-200-distilled-600M \
  --copy_files tokenizer.json
```

如果你更偏向 NAS 上直接挂载现成模型，也可以先在一台有 Python/transformers 环境的机器上完成转换，再把整个 `models/nllb-200-distilled-600M` 目录拷到 NAS。

注意：

- Hugging Face 原始 `facebook/nllb-200-distilled-600M` 模型卡标明许可为 `CC-BY-NC-4.0`
- 当前服务依赖的是已经转换好的 CTranslate2 模型目录

## 2. 本地开发

```bash
cp .env.example .env
cargo run
```

默认监听 `0.0.0.0:8080`。

## 3. Docker / NAS 部署

```bash
docker compose up -d --build
```

适合群晖、威联通、Unraid 一类支持 Compose 的 NAS。部署前确保：

- `./models` 已经包含转换后的 NLLB 模型
- `8080` 端口未被占用
- NAS 有足够内存加载模型

## 4. API

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

状态查看：

```bash
curl http://127.0.0.1:8080/v1/status
```

翻译：

```bash
curl -X POST http://127.0.0.1:8080/v1/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world",
    "source_lang": "eng_Latn",
    "target_lang": "zho_Hans"
  }'
```

## 5. 环境变量

- `APP_BIND`: 服务监听地址
- `MODEL_DIR`: CTranslate2 模型目录
- `DEFAULT_SOURCE_LANG`: 默认源语言
- `DEFAULT_TARGET_LANG`: 默认目标语言
- `CT2_DEVICE`: `cpu` 或 `cuda`
- `CT2_COMPUTE_TYPE`: `default` / `auto` / `int8` / `float16` 等
- `CT2_THREADS`: 每个 replica 的线程数
- `TRANSLATION_BEAM_SIZE`: beam size
- `TRANSLATION_MAX_INPUT_LENGTH`: 最大输入长度
- `TRANSLATION_MAX_DECODING_LENGTH`: 最大生成长度

## 6. 当前骨架边界

这个骨架优先解决“可直接部署到 NAS”的结构问题，没有额外引入鉴权、限流、任务队列和后台管理。

NLLB 的 tokenizer/语言标签处理在不同实现里会有细节差异。当前骨架使用：

- 源文本前缀化：`{source_lang} {text}`
- 目标语言前缀：`translate_batch_with_target_prefix(..., [[target_lang]], ...)`

它适合作为部署起点，但如果你后面要往生产服务推进，建议继续补：

- 多语种回归测试
- 批量翻译接口
- 背压和队列
- API Key 鉴权
- 结果缓存
- GPU/CUDA 镜像变体
