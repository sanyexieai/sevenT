# NAS NLLB Service / NAS NLLB 翻译服务

中文：
这是一个面向 NAS、家庭服务器和本地调试环境的页面翻译项目，包含两个部分：
- 一个基于 `Rust + Axum + ct2rs + CTranslate2 + NLLB` 的 HTTP 翻译服务
- 一个 Chrome 扩展，用来把网页中的文本提取、翻译并回填到页面

English:
This repository contains a page translation stack for NAS, homelab, and local development use cases:
- A `Rust + Axum + ct2rs + CTranslate2 + NLLB` HTTP translation service
- A Chrome extension that extracts page text, translates it, and writes the translated content back into the DOM

## Screenshots / 界面截图

中文：
下面两张截图展示了扩展在 Hugging Face 页面上的实际效果：
- `compare` 模式：保留原页面结构，并在原文附近插入译文
- `replace` 模式：直接把页面中的文本替换为译文

English:
The two screenshots below show the extension behavior on a Hugging Face page:
- `compare` mode keeps the original structure and injects translated content nearby
- `replace` mode directly replaces page text with translated output

![Compare Mode Screenshot / 对比模式截图](<doc/截图 2026-04-12 00-01-47.png>)

![Replace Mode Screenshot / 覆盖模式截图](<doc/截图 2026-04-12 00-05-28.png>)

## Overview / 项目概览

中文：
这个项目的目标不是做一个“通用浏览器翻译器平台”，而是优先解决下面几件事：
- 能在 NAS 或 Docker 环境里稳定部署
- 能直接接收网页文本翻译请求
- 能通过扩展完成整页翻译、恢复原文、对比显示、覆盖显示
- 对包含路径、代码样式、CamelCase、缩写词、特殊符号的文本做尽量稳妥的处理

English:
The project is optimized for practical deployment rather than for being a full browser translation platform. It focuses on:
- Stable NAS and Docker deployment
- A direct HTTP translation endpoint
- Whole-page translation, restore, compare mode, and replace mode through the extension
- Safer handling for paths, code-like strings, CamelCase text, abbreviations, and symbol-heavy content

## Quick Start / 快速开始

中文：
- 想直接安装扩展并完成首次配置，参考 [Chrome 插件安装与配置指南](doc/chrome-extension-install.md)
- 想下载已经打好的发布构建，使用 GitHub Releases 中的后端归档包和扩展 zip

English:
- For the quickest end-user setup flow, see [Chrome Extension Install Guide](doc/chrome-extension-install.md)
- Prebuilt backend archives and extension zip files are published through GitHub Releases
标准启动流程如下：
1. 准备好 `models/nllb-200-distilled-600M/`
2. 启动本地服务：`cargo run`
3. 打开 `chrome://extensions`
4. 加载 `chrome-extension/`
5. 在扩展弹窗中把接口地址指向 `http://127.0.0.1:8080`
6. 打开任意网页，点击“翻译整页”

English:
Standard startup flow:
1. Prepare `models/nllb-200-distilled-600M/`
2. Start the service with `cargo run`
3. Open `chrome://extensions`
4. Load `chrome-extension/`
5. Point the extension endpoint to `http://127.0.0.1:8080`
6. Open any page and trigger whole-page translation

## Architecture / 架构说明

中文：
整体链路如下：
- 浏览器扩展扫描页面文本和常见属性文本
- 扩展按规则切分文本，保留结构符号，清洗模型不需要的噪声
- 扩展通过 HTTP 调用本地翻译服务
- Rust 服务使用 `ct2rs + CTranslate2` 加载 NLLB 模型并返回结果
- 扩展把译文按 `compare` 或 `replace` 模式回填到页面

English:
The end-to-end flow is:
- The browser extension scans visible text and common text-bearing attributes
- The extension segments text, preserves structural symbols, and removes model-side noise
- The extension sends translation requests to the local HTTP service
- The Rust service runs NLLB through `ct2rs + CTranslate2`
- The extension writes the translated output back using either `compare` or `replace` mode

## Repository Layout / 目录结构

```text
.
├─ src/                         # Rust service
├─ chrome-extension/            # Chrome extension
├─ models/
│  └─ nllb-200-distilled-600M/  # Converted CTranslate2 model directory
├─ compose.yaml
├─ compose.gpu.yaml
└─ Dockerfile
```

## Features / 功能特性

中文：
- `Axum` HTTP API，提供健康检查、状态查看和翻译接口
- `ct2rs` 驱动 CTranslate2 推理
- 面向 Docker / NAS 的目录约定，模型目录可直接挂载
- Chrome 扩展支持整页翻译、恢复原文、右键菜单、侧边快捷按钮
- 支持 `compare` 与 `replace` 两种渲染模式
- 支持 OpenAI 兼容接口和本地 NLLB HTTP 接口
- 支持页面动态更新后的增量翻译
- 支持翻页后自动续翻
- 支持内置白名单跳过与自定义白名单
- 会在发送到翻译服务前清洗符号，但尽量保留原始页面结构

English:
- `Axum` HTTP API with health, status, and translate endpoints
- CTranslate2 inference via `ct2rs`
- Docker/NAS-friendly model directory layout
- Chrome extension with whole-page translation, restore, context menu, and floating shortcut buttons
- `compare` and `replace` rendering modes
- Support for both local NLLB HTTP service and OpenAI-compatible HTTP APIs
- Incremental translation for dynamically updated pages
- Sticky translation state across page navigation
- Built-in skip whitelist plus editable custom whitelist
- Symbol cleanup before translation while preserving original page structure as much as possible

## Model Preparation / 模型准备

中文：
项目默认使用 `facebook/nllb-200-distilled-600M` 转换得到的 CTranslate2 模型。

模型转换命令如下：

```bash
pip install ctranslate2 huggingface_hub torch transformers
ct2-transformers-converter --model facebook/nllb-200-distilled-600M \
  --output_dir models/nllb-200-distilled-600M \
  --copy_files tokenizer.json
```

转换后，模型目录至少需要包含：

```text
models/nllb-200-distilled-600M/
├─ model.bin
└─ tokenizer.json
```

使用 SentencePiece 文件时，目录结构如下：

```text
models/nllb-200-distilled-600M/
├─ model.bin
├─ source.spm
└─ target.spm
```

English:
By default, the project expects a CTranslate2-converted version of `facebook/nllb-200-distilled-600M`.

Reference conversion command:

```bash
pip install ctranslate2 huggingface_hub torch transformers
ct2-transformers-converter --model facebook/nllb-200-distilled-600M \
  --output_dir models/nllb-200-distilled-600M \
  --copy_files tokenizer.json
```

The converted model directory must contain at least:

```text
models/nllb-200-distilled-600M/
├─ model.bin
└─ tokenizer.json
```

SentencePiece-based setup is also supported if both `source.spm` and `target.spm` are present.

说明 / Notes:
- Hugging Face upstream model license is `CC-BY-NC-4.0`
- This service depends on the converted CTranslate2 model directory rather than the original Transformers checkpoint

## Local Development / 本地开发

中文：
`ct2rs` 会间接依赖 `sentencepiece-sys`，本地构建需要 `cmake`：

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y cmake pkg-config build-essential clang
```

NVIDIA GPU 部署需要额外安装 CUDA Toolkit。

启动本地服务：

```bash
cargo run
```

默认监听：

```text
0.0.0.0:8080
```

English:
`ct2rs` indirectly depends on `sentencepiece-sys`, so `cmake` is typically required for local builds:

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y cmake pkg-config build-essential clang
```

GPU deployment requires CUDA Toolkit to be installed separately.

Start the local service:

```bash
cargo run
```

Default bind address:

```text
0.0.0.0:8080
```

## Docker and NAS Deployment / Docker 与 NAS 部署

中文：
`compose.yaml` 提供 CPU 部署路径，适用于通用 NAS 环境。

CPU 部署：

```bash
cargo build --release --no-default-features
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-cpu
docker compose up -d --build
```

GPU 部署：

```bash
cargo build --release
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-gpu
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

English:
`compose.yaml` provides the CPU deployment path for general NAS setups.

CPU deployment:

```bash
cargo build --release --no-default-features
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-cpu
docker compose up -d --build
```

GPU deployment:

```bash
cargo build --release
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-gpu
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

部署要求 / Deployment requirements:
- `./models` contains the converted model
- Port `8080` is free
- The NAS has enough memory to load the model
- GPU mode requires NVIDIA Container Toolkit configured on the host

## Release Automation / 自动发布构建

中文：
仓库内置了 GitHub Actions 发布流程 [release-build.yml](.github/workflows/release-build.yml)，用于自动产出发布版本构建物。

默认行为：
- 推送到 `main` 时自动构建
- 推送 `v*` 标签时自动构建并发布 GitHub Release
- 支持手动触发 `workflow_dispatch`

产物包括：
- 后端 CPU 发布包
  - `linux-x86_64`
  - `windows-x86_64`
  - `macos-aarch64`
- 后端 GPU 发布包
  - `linux-x86_64`
- Chrome 扩展发布包
  - `nas-page-translator-chrome-extension-v*.zip`
  - `nas-page-translator-chrome-extension-v*.crx`

English:
The repository ships with [release-build.yml](.github/workflows/release-build.yml) for automated release builds.

It:
- builds automatically on pushes to `main`
- builds and publishes a GitHub Release for `v*` tags
- supports manual runs through `workflow_dispatch`

Published artifacts include CPU backend archives for Linux, Windows, and Apple Silicon macOS, plus packaged Chrome extension `zip` and `crx` files.

## HTTP API / HTTP 接口

健康检查 / Health check:

```bash
curl http://127.0.0.1:8080/healthz
```

状态查看 / Service status:

```bash
curl http://127.0.0.1:8080/v1/status
```

翻译请求 / Translate request:

```bash
curl -X POST http://127.0.0.1:8080/v1/translate \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello world",
    "source_lang": "eng_Latn",
    "target_lang": "zho_Hans"
  }'
```

响应示例 / Example response:

```json
{
  "translated_text": "你好，世界",
  "score": -0.42,
  "source_lang": "eng_Latn",
  "target_lang": "zho_Hans"
}
```

## Chrome Extension / Chrome 扩展

中文：
扩展目录位于 `chrome-extension/`，可直接作为本地调试扩展加载。
如果你是普通安装用户，优先参考 [Chrome 插件安装与配置指南](doc/chrome-extension-install.md)。

加载方式：

```bash
# 先启动本地翻译服务
cargo run
```

然后打开：

```text
chrome://extensions
```

操作步骤：
- 打开“开发者模式”
- 选择“加载已解压的扩展程序”
- 选中仓库内的 `chrome-extension/`
- 打开任意网页，点击扩展图标或页面右侧快捷按钮

English:
The extension lives in `chrome-extension/` and can be loaded unpacked for local testing.
End users should prefer the guided install doc: [Chrome Extension Install Guide](doc/chrome-extension-install.md).

Steps:
- Start the local translation service first
- Open `chrome://extensions`
- Enable Developer Mode
- Load the `chrome-extension/` directory as an unpacked extension
- Open any web page and use either the popup or the floating shortcut buttons

### Extension Capabilities / 扩展能力

中文：
- 支持整页翻译与恢复原文
- 支持右键菜单直接触发翻译
- 支持页面右侧快捷按钮
- 支持 `compare` 与 `replace` 模式
- 支持页面动态更新时的增量翻译
- 支持翻页后自动续翻
- 支持重复文本缓存，减少重复请求
- 支持常见属性文本翻译，如 `title`、`aria-label`、`alt`、`placeholder`
- 支持用户自定义白名单

English:
- Whole-page translation and restore
- Context menu entry for one-click translation
- Floating shortcut buttons on the right side of the page
- `compare` and `replace` rendering modes
- Incremental translation for dynamic page changes
- Sticky translation state across navigation
- Reuse cache for repeated strings
- Translation of common attributes such as `title`, `aria-label`, `alt`, and `placeholder`
- User-editable custom skip whitelist

### Translation Strategy / 翻译策略

中文：
扩展采用“白名单跳过，其余尽量翻译”的策略。

内置白名单会明确跳过：
- URL
- 邮箱
- 明确的多段绝对路径
- Windows 路径
- HTML 标签与实体
- 域名
- 版本号
- 长哈希串

除此之外，页面可见文本默认都会尽量尝试翻译。

English:
The extension now uses a "skip only explicit whitelist items, translate everything else aggressively" strategy.

Built-in whitelist skips:
- URLs
- Email addresses
- Clear multi-segment absolute paths
- Windows file paths
- HTML tags and entities
- Domain names
- Version strings
- Long hashes

Everything else that looks like visible page text is translated as aggressively as possible.

### Symbol Handling / 符号处理

中文：
发送到翻译接口之前，会尽量把符号从正文里剥离出去，但保留在原始结构中。

例如：
- `internlm/WildClawBench` 会拆成 `internlm` + `/` + `WildClawBench`
- `foo-bar_baz` 会拆成 `foo` + `-` + `bar` + `_` + `baz`

符号本身不会交给翻译服务，但会在最终回填时保持原位。

English:
Before sending text to the translation service, the extension strips symbols from the translatable text while preserving the original structural separators.

Examples:
- `internlm/WildClawBench` becomes `internlm` + `/` + `WildClawBench`
- `foo-bar_baz` becomes `foo` + `-` + `bar` + `_` + `baz`

Symbols are not translated, but they are preserved in the final reconstructed output.

### Compact Tokens and Abbreviations / 紧凑词与缩写词处理

中文：
扩展会尽量处理以下文本：
- CamelCase，例如 `WildClawBench`
- 字母数字混合，例如 `Wild3lawBench`
- 带横杠或斜杠的复合词，例如 `full-text-search`

如果模型把缩写词翻成纯特殊 token，例如 `UPD -> <unk>`，扩展会保留原缩写，避免出现 `MM-/MM-` 这类丢词结果。

English:
The extension handles:
- CamelCase tokens such as `WildClawBench`
- mixed alpha-numeric tokens such as `Wild3lawBench`
- hyphen/slash compounds such as `full-text-search`

If the model collapses an abbreviation into pure special tokens, such as `UPD -> <unk>`, the extension preserves the original abbreviation instead of dropping it.

### Special Token Cleanup / 特殊 token 清洗

中文：
扩展会统一过滤模型输出中的特殊 token，例如：
- `<unk>`
- `<s>`
- `</s>`
- `<pad>`
- `<mask>`
- 语言标签，例如 `eng_Latn`、`zho_Hans`

English:
The extension removes model-side special tokens from translated output, including:
- `<unk>`
- `<s>`
- `</s>`
- `<pad>`
- `<mask>`
- language tags such as `eng_Latn` and `zho_Hans`

### Compare vs Replace / 对比模式与覆盖模式

中文：
- `compare`：保留原文，并在原结构附近插入译文
- `replace`：直接用译文覆盖页面文本

为了减少行内元素显示不全的问题，扩展现在对块级元素和行内元素走不同的 compare 渲染逻辑。

English:
- `compare`: keep the original text and inject translated content nearby
- `replace`: directly replace page text with translated output

To reduce clipping issues for inline content, compare rendering now uses separate paths for block-level and inline-level elements.

### Dynamic Content / 动态页面支持

中文：
页面第一次翻译成功后，扩展会启用 `MutationObserver`：
- 对动态插入的新内容做增量翻译
- 对 SPA 页面、懒加载列表、异步加载区域更友好

English:
After the first successful translation, the extension enables a `MutationObserver`:
- newly inserted content is translated incrementally
- this improves behavior on SPA pages, lazy-loaded lists, and async content areas

### Navigation Persistence / 翻页状态保持

中文：
整页翻译开启后，页面导航后扩展会自动续翻。
按钮状态和右键菜单状态会与该持续翻译状态同步。

English:
When whole-page translation is enabled, the extension automatically re-applies translation after navigation.
The floating shortcut button state and context menu state stay in sync with that sticky translation state.

## Popup Settings / 弹窗设置说明

中文：
弹窗里可以配置：
- 翻译 Provider
- 接口地址
- 渲染模式
- 模型名称
- API Key
- 源语言
- 目标语言
- 单次最大处理数
- 自定义白名单

自定义白名单写法：
- 每行一条
- 纯文本表示精确匹配，例如 `internlm`
- `/正则/flags` 表示正则规则，例如 `/^github$/i`

English:
Popup settings include:
- translation provider
- endpoint
- rendering mode
- model name
- API key
- source language
- target language
- max items per translation pass
- custom skip whitelist

Custom whitelist syntax:
- one rule per line
- plain text means exact match, for example `internlm`
- `/regex/flags` means a regular-expression rule, for example `/^github$/i`

## Supported Providers / 支持的 Provider

- `http_nllb`: current local `nas-nllb-service` style HTTP API
- `http_openai_chat`: OpenAI Chat Completions compatible endpoint
- `http_openai_responses`: OpenAI Responses compatible endpoint
- `mcp`: placeholder for MCP integration
- `native_app`: placeholder for local app / bridge integration

## Environment Variables / 环境变量

中文：
- `APP_BIND`：服务监听地址
- `MODEL_DIR`：CTranslate2 模型目录
- `REQUEST_LOG_PATH`：请求日志路径，默认 `logs/requests.jsonl`
- `DEFAULT_SOURCE_LANG`：默认源语言
- `DEFAULT_TARGET_LANG`：默认目标语言
- `CT2_DEVICE`：`auto` / `cpu` / `cuda`
- `CT2_COMPUTE_TYPE`：`default` / `auto` / `int8` / `float16` 等
- `CT2_THREADS`：每个副本使用的线程数
- `TRANSLATION_BEAM_SIZE`：Beam Search 大小
- `TRANSLATION_MAX_INPUT_LENGTH`：最大输入长度
- `TRANSLATION_MAX_DECODING_LENGTH`：最大生成长度

English:
- `APP_BIND`: bind address for the HTTP service
- `MODEL_DIR`: CTranslate2 model directory
- `REQUEST_LOG_PATH`: request log path, default `logs/requests.jsonl`
- `DEFAULT_SOURCE_LANG`: default source language
- `DEFAULT_TARGET_LANG`: default target language
- `CT2_DEVICE`: `auto` / `cpu` / `cuda`
- `CT2_COMPUTE_TYPE`: `default` / `auto` / `int8` / `float16`, etc.
- `CT2_THREADS`: thread count per model replica
- `TRANSLATION_BEAM_SIZE`: beam-search width
- `TRANSLATION_MAX_INPUT_LENGTH`: maximum source length
- `TRANSLATION_MAX_DECODING_LENGTH`: maximum decoding length

## Request Logs / 请求日志

中文：
每次调用 `POST /v1/translate` 都会写入一条 JSON Lines 记录。

默认日志路径：
- [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl)

默认记录内容包括：
- 请求时间
- 源/目标语言
- 文本长度
- 文本预览
- 客户端 IP
- User-Agent
- 是否成功
- 耗时
- score
- 错误信息

English:
Every `POST /v1/translate` call is written to a JSON Lines request log.

Default log path:
- [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl)

Recorded fields include:
- request time
- source/target language
- text length
- text preview
- client IP
- user agent
- success flag
- elapsed time
- score
- error message

## Troubleshooting / 常见问题

中文：
- 扩展点了没反应：先确认服务是否能正常访问 `http://127.0.0.1:8080/healthz`
- 页面翻译后刷新丢失：确认扩展是否已重新加载到最新版本
- 某些词没翻：先看 [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl) 是否收到对应请求
- 出现 `<unk>`、`<pad>` 等：前端会清洗这类 token；如果仍然可见，通常表示扩展仍在运行旧脚本
- 动态页面没自动补翻：该能力在页面进入翻译状态后生效，异步内容会在首次整页翻译完成后继续处理

English:
- Nothing happens when the extension is clicked: verify `http://127.0.0.1:8080/healthz` is reachable
- Translation state is lost after refresh: make sure the extension was reloaded after recent changes
- A specific term is not translated: inspect [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl) and verify the request actually reached the backend
- You still see `<unk>` or `<pad>`: the frontend should strip these tokens, so this usually means an older extension build is still running
- Dynamic content was not re-translated: this capability becomes active after the page enters translated state, and async content continues to be processed after the initial full-page pass

## Development Notes / 开发说明

中文：
- 项目以“本地可部署、前后端可调试”为主要设计目标
- 扩展侧逻辑较多，排查前端问题时优先看控制台和请求日志
- Provider 扩展保持现有配置结构，有利于降低兼容性调整成本

English:
- The repository is designed primarily for deployability and debuggability
- Most tricky issues happen on the extension side, so browser console output and request logs are usually the first places to inspect
- Keeping the current config shape stable reduces maintenance cost when additional providers are introduced

## License Notes / 许可说明

中文：
本仓库代码的许可方式请以仓库内实际 License 文件或作者声明为准。
模型部分请特别注意上游 Hugging Face / Meta NLLB 的许可条件。

English:
The code license for this repository should follow the actual license file or maintainer statement in the repo.
Please also review the upstream Hugging Face / Meta NLLB model license terms before redistribution or commercial use.

## Current Boundaries / 当前边界

中文：
该项目当前提供“可部署、可调试、可迭代”的基础能力，尚未覆盖完整生产平台能力。

当前未包含：
- 鉴权
- 限流
- 后台管理
- 任务队列
- 批量翻译 API

生产化增强方向包括：
- 多语言回归测试
- 结果缓存
- API Key 鉴权
- 更细的术语表
- 更强的批处理与队列
- 更细致的前端页面分块策略

English:
This repository currently provides a deployable, debuggable, and extensible foundation rather than a full production translation platform.

Not included at this stage:
- authentication
- rate limiting
- admin panel
- task queue
- batch translation API

Production-hardening directions:
- multilingual regression tests
- translation result caching
- API key based auth
- richer glossary support
- stronger batching and queueing
- more advanced page segmentation logic in the extension
