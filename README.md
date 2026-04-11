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

转换完成后，模型目录里至少应包含这些文件：

```text
models/nllb-200-distilled-600M/
├─ model.bin
└─ tokenizer.json
```

如果你走的是 SentencePiece 路线，那么也可以提供：

```text
models/nllb-200-distilled-600M/
├─ model.bin
├─ source.spm
└─ target.spm
```

如果你更偏向 NAS 上直接挂载现成模型，也可以先在一台有 Python/transformers 环境的机器上完成转换，再把整个 `models/nllb-200-distilled-600M` 目录拷到 NAS。

注意：

- Hugging Face 原始 `facebook/nllb-200-distilled-600M` 模型卡标明许可为 `CC-BY-NC-4.0`
- 当前服务依赖的是已经转换好的 CTranslate2 模型目录

## 2. 本地开发

先安装本地编译依赖。`ct2rs` 间接依赖 `sentencepiece-sys`，构建时需要 `cmake`：

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y cmake pkg-config build-essential clang
```

如果机器有 NVIDIA GPU，并且希望优先使用 CUDA，再额外安装 CUDA Toolkit。以 Ubuntu 24.04 为例：

```bash
sudo apt-get update
sudo apt-get install -y wget gnupg
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb -O /tmp/cuda-keyring.deb
sudo dpkg -i /tmp/cuda-keyring.deb
sudo apt-get update
sudo apt-get install -y cuda-toolkit-13-0
```

安装完成后确认：

```bash
/usr/local/cuda/bin/nvcc --version
nvidia-smi
```

当前项目默认会：

- 使用 `CT2_DEVICE=auto`，检测到 NVIDIA GPU 时优先选择 `cuda`
- 使用 `CT2_COMPUTE_TYPE=auto`
- 通过 `.cargo/config.toml` 默认读取 `CUDA_TOOLKIT_ROOT_DIR=/usr/local/cuda`

如果你要在本机直接编译 GPU 版本的 release 二进制：

```bash
cargo build --release
```

```bash
cp .env.example .env
cargo run
```

默认监听 `0.0.0.0:8080`。

## 3. Docker / NAS 部署

默认 `compose.yaml` 走 CPU 安全路径，不要求宿主机有 NVIDIA GPU：

```bash
cargo build --release --no-default-features
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-cpu
docker compose up -d --build
```

如果宿主机已经装好 NVIDIA Container Toolkit，并且希望容器优先使用 GPU，则使用 GPU 覆盖文件：

```bash
cargo build --release
mkdir -p .dist
cp /home/sanye/.cache/cargo-target/sevenT/release/nas-nllb-service .dist/nas-nllb-service-gpu
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

适合群晖、威联通、Unraid 一类支持 Compose 的 NAS。部署前确保：

- `./models` 已经包含转换后的 NLLB 模型
- `8080` 端口未被占用
- NAS 有足够内存加载模型

补充说明：

- CPU 默认路径会构建 `runtime-cpu` 镜像，并在容器内固定 `CT2_DEVICE=cpu`
- GPU 覆盖路径会切换到 `runtime-gpu` 镜像，并注入 `gpus: all`
- CPU 运行时镜像使用 `ubuntu:24.04`，避免和本机编译出的 glibc 版本不匹配
- CPU Docker 路径会打包宿主机本地的 `.dist/nas-nllb-service-cpu`
- GPU Docker 路径会打包宿主机本地的 `.dist/nas-nllb-service-gpu`
- 由于当前仓库把 Cargo 输出目录放在 `/home/sanye/.cache/cargo-target/sevenT`，所以 Docker 构建前先在本机编译，再把对应二进制复制到 `.dist/`
- CPU 版建议用 `cargo build --release --no-default-features`
- GPU 版建议用 `cargo build --release`
- 同一个项目目录不要同时启动这两套配置，否则会同时争用 `8080`
- GPU 路径要求宿主机已经安装并配置好 NVIDIA Container Toolkit
- Compose 默认会把宿主机的 `./logs` 挂载到容器内 `/logs`
- 容器内的请求日志默认写到 `/logs/requests.jsonl`，宿主机上对应就是 [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl)
- 建议把 `.dist/` 当成 Docker 打包专用目录，例如：
  - `.dist/nas-nllb-service-cpu`
  - `.dist/nas-nllb-service-gpu`

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

## 5. Chrome Extension

仓库里提供了一个本地调试用的 Chrome 扩展目录：`chrome-extension/`。

加载方式：

```bash
# 先启动本地翻译服务
cargo run
```

然后在 Chrome 打开：

```text
chrome://extensions
```

操作步骤：

- 打开右上角“开发者模式”
- 选择“加载已解压的扩展程序”
- 选中仓库里的 `chrome-extension` 目录
- 打开任意网页，点击扩展图标
- 默认会请求 `http://3ye.co:18080/`
- 弹窗设置界面已改为中文
- 点击“翻译整页”后，扩展会扫描页面文本节点、调用翻译接口，再把译文回填到页面
- 点击“显示原文”可以恢复原文

当前扩展能力：

- 支持配置翻译 provider、endpoint、源语言、目标语言、渲染模式
- 支持限制单次最多处理多少个翻译目标，默认 `400`
- 支持右键页面后，使用“翻译整页为中文”菜单直接触发全文翻译
- 翻译成功后，右键菜单会切换成“显示原文”，方便一键恢复；页面刷新后会自动回到“翻译整页为中文”
- 会跳过 `script`、`style`、`textarea`、`input`、`code`、`pre` 等节点
- 对重复文本会做简单缓存，避免同一句话重复请求
- 整页翻译和恢复原文默认静默执行；只有失败时才显示右上角错误提示
- 页面文本请求会通过扩展后台转发到本地翻译服务，避免普通网页环境下的跨域/混合内容限制
- 页面刚刷新时，扩展会等待标签页加载完成后再开始整页翻译
- 会保护 URL、邮箱、版本号、路径、CamelCase、snake_case 等代码样式或关键字样式内容，减少误翻
- 如果模型仍然输出 `<unk>`，扩展会优先尝试用原始关键字片段回填，尽量避免页面上直接出现 `<unk>`
- 当前版本会把文本拆成“正文片段”和“保留片段”分别处理，原样保留 URL、路径、代码样式片段和 HTML 标签样式片段
- 如果节点文本已经很像目标语言，例如目标是中文且文本本身已经主要是中文，这类节点会直接跳过，不再重复翻译
- 这种“已是目标语言就跳过”的判断不只在节点级做，也会在分段翻译时对每个片段单独判断，尽量避免中文片段被再次送去中译中
- 除了普通文本节点，也会尝试翻译 `title`、`aria-label`、`alt`、`placeholder` 等常见属性文本
- 页面可见文案默认都尽量纳入翻译，按钮、菜单、导航文本本身不会因为位置或角色而被跳过
- `400` 不是模型限制，而是扩展默认的单次处理上限，用来避免整页第一次翻译时请求量过大；你可以在弹窗里把它调高
- 支持两种渲染方案：
  - `compare`: 保留原文，并在原结构下方复制一份译文结构，做上下对照
  - `replace`: 直接用译文覆盖原文
- 默认渲染方案是 `compare`
- 默认 NLLB endpoint 已改为 `http://3ye.co:18080/`；如果只填根地址，扩展会自动补到 `/v1/translate`
- 页面右侧会显示一个快捷悬浮按钮组，可以直接点击“翻译整页 / 显示原文”，也可以一键切换“对比 / 覆盖”模式
- 如果当前页面已经翻译完成，再切换渲染模式时，扩展会立即按新模式重新渲染

当前 provider 抽象：

- `http_nllb`: 适配当前本地 `nas-nllb-service` 这类 `text/source_lang/target_lang` HTTP 接口
- `http_openai_chat`: 适配 OpenAI Chat Completions 兼容接口
- `http_openai_responses`: 适配 OpenAI Responses 兼容接口
- `mcp`: 预留给后续 MCP 接入
- `native_app`: 预留给后续本地软件/桥接程序接入

扩展里的页面解析、节点筛选、整页回填逻辑不再依赖某个固定翻译接口。后续如果你要切换到别的 HTTP 服务、MCP、本地软件或 LLM，只需要在 `chrome-extension/translators.js` 里增加 provider 或补完预留 provider 即可。

注意：

- 这是一个“直接替换 DOM 文本节点”的轻量方案，适合网页阅读和本地验证
- 对结构复杂、动态更新频繁的网站，部分文本可能不会被完整覆盖
- 当前服务接口是逐段请求，所以整页翻译速度取决于网页文本节点数量
- 如果你后面要做成更强的版本，建议继续补：节点分块、增量翻译、MutationObserver、选择区域翻译、术语缓存

## 6. 环境变量

- `APP_BIND`: 服务监听地址
- `MODEL_DIR`: CTranslate2 模型目录
- `REQUEST_LOG_PATH`: 请求日志落盘路径，默认 `logs/requests.jsonl`
- `DEFAULT_SOURCE_LANG`: 默认源语言
- `DEFAULT_TARGET_LANG`: 默认目标语言
- `CT2_DEVICE`: `auto` / `cpu` / `cuda`，默认 `auto`，检测到 NVIDIA GPU 时优先使用 `cuda`
- `CT2_COMPUTE_TYPE`: `default` / `auto` / `int8` / `float16` 等
- `CT2_THREADS`: 每个 replica 的线程数
- `TRANSLATION_BEAM_SIZE`: beam size
- `TRANSLATION_MAX_INPUT_LENGTH`: 最大输入长度
- `TRANSLATION_MAX_DECODING_LENGTH`: 最大生成长度

请求日志说明：

- 每次调用 `POST /v1/translate` 都会追加一条 JSON Lines 记录到 `REQUEST_LOG_PATH`
- 默认记录字段包括：请求时间、源/目标语言、文本长度、文本预览、客户端 IP、User-Agent、是否成功、耗时、score、错误信息
- 默认日志文件路径是 [logs/requests.jsonl](/media/sanye/代码/code/rust/sevenT/logs/requests.jsonl)

## 7. 当前骨架边界

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
