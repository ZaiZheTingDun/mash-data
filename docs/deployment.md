# 资源构建与部署

**官方 Mash 数据包通过本仓库的 GitHub Actions 自动构建和发布**：更新 Action 维护官方 private 仓库中的数据与 state，发布 Action 基于其最新提交校验、打包并上传官方 R2。维护流程及发布环境配置见 [官方 Mash 数据包构建与发布](pipelines.md)。两条 Action 目前均由维护者手动触发，后续步骤自动执行。

本文介绍底层 Python 资源构建工具和 Bash 上传脚本，供本地构建、调试和手动操作时参考。所有命令从**代码仓库根目录**执行；文中 `assets/`、`dist/` 均位于 `MASH_DATA_ROOT` 指定的数据目录中。以下手动命令保留原有行为；官方发布 Action 使用 `pipeline_release.py` 执行条件写入、回读校验和最后切换 latest。

[返回项目首页](../README.md) · [数据获取与缓存](data-fetch-strategy.md)

## 准备输入

需要 Python 3；增量补丁和 R2 上传还需要已配置凭据的 AWS CLI，上传脚本需要 Bash。

```bash
export MASH_DATA_ROOT=/absolute/path/to/your-data
```

构建工具读取已有资源，不会自动下载数据。完整基础包需要 `assets/servants/`、`ces/`、`icons/`、`mystic-codes/` 和 `skills/` 下相应的 JSON 与图片；每个基础分包都必须有匹配文件。

版本配置在 `assets/version.json`：

```json
{ "version": 1 }
```

使用本文的底层手动构建命令时，发布清单源文件为 `assets/manifest.json`，需由维护者准备；官方发布 Action 会在 runner 中自动递增版本并生成清单，在 R2 发布成功后将完整清单和版本号提交回 private。下面是版本 1 基础发布的完整分包示例，版本号仅作演示：

```json
{
  "latest": 1,
  "latestBase": 1,
  "base": {
    "version": 1,
    "packs": [
      { "name": "assets-json", "file": "base/v1/assets-json-v1.zip" },
      { "name": "servant-images", "file": "base/v1/servant-images-v1.zip" },
      { "name": "ce-images", "file": "base/v1/ce-images-v1.zip" },
      { "name": "icon-images", "file": "base/v1/icon-images-v1.zip" },
      { "name": "mystic-code-json", "file": "base/v1/mystic-code-json-v1.zip" },
      { "name": "mystic-code-images", "file": "base/v1/mystic-code-images-v1.zip" },
      { "name": "skill-json", "file": "base/v1/skill-json-v1.zip" }
    ]
  },
  "patches": []
}
```

发布 v1 到 v2 的补丁时，将资源版本更新为 2，清单的 `latest` 改为 2，保留对应基础版本与历史补丁，并向 `patches` 追加：

```json
{ "from": 1, "to": 2, "file": "patches/v1-to-v2.zip" }
```

清单中的 `file` 相对于 `dist/assets-release/`。构建时会补齐 ZIP 的 `sha256` 和 `size`；新文件从本地计算，历史文件可复用上一版 R2 清单中的元数据。

## 选择构建方式

### 基础资源包

```bash
python3 scripts/release.py base
```

版本取自 `assets/version.json`，生成七个分包：

| 分包 | 内容 |
| --- | --- |
| `assets-json` | 从者与概念礼装 JSON |
| `servant-images` | 从者图片 |
| `ce-images` | 概念礼装图片 |
| `icon-images` | 图标图片 |
| `mystic-code-json` | 魔术礼装 JSON |
| `mystic-code-images` | 魔术礼装图片 |
| `skill-json` | 技能依赖 JSON |

### 增量补丁

```bash
export R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
export R2_BUCKET=your-bucket
python3 scripts/release.py patch --from v1 --to v2
```

版本参数使用 `v<整数>`，目标版本必须大于源版本。构建器从 R2 读取前一版 `manifests/manifest-v1.json` 与 `states/asset-state-v1.json`，按路径和 SHA-256 比较本地文件，生成新增、修改和删除清单。

差异依据磁盘上的资源内容，包含本地存在但被 Git 忽略的图片。历史发布如果没有状态文件，需要先提供与该版本内容一致的状态文件，才能以它为基础构建补丁。

补丁构建只生成当前补丁、当前状态和更新后的发布清单，历史 ZIP 通过清单继续引用 R2 中的原对象，不会重新下载或构建。

**`base` 和 `patch` 都会清空数据目录下整个 `dist/`，再写入当前发布产物。** 需要保留的旧产物应先移走；补丁缺少本地源文件会产生删除记录，构建前应确认数据目录完整。

### 离线导入包

```bash
npm run assets:offline-base
```

生成 `dist/offline/mash-assets-v<版本>.zip` 及 `.zip.sha256`，包含受管理的资源与 `assets-version.json`。版本同样读取 `assets/version.json`。该命令不清空 `dist/`，也不改动 `dist/assets-release/`。

## 产物与文件范围

基础或补丁发布输出到：

```text
dist/assets-release/
├── base/v<版本>/<分包名>-v<版本>.zip      # 基础构建时生成
├── patches/v<源版本>-to-v<目标版本>.zip  # 补丁构建时生成
├── states/asset-state-v<版本>.json
├── manifests/manifest-v<最新版本>.json
└── latest.json
```

每个 ZIP 带有 `.zip.sha256` 校验文件。基础 ZIP 内含 `pack-manifest.json`，记录文件路径、大小和 SHA-256；补丁 ZIP 内含新增和修改文件、`patch-manifest.json` 及 `deletes.json`。

受管理文件为 `assets/` 下 `servants`、`ces`、`icons`、`mystic-codes`、`skills` 目录中的 JSON 和 PNG/WebP/JPG/JPEG 图片。ZIP 内路径相对于 `assets/`，例如 `assets/servants/1/servant.json` 打包为 `servants/1/servant.json`。

`servant-raw.json`、`servant-cn-raw.json` 和 `.DS_Store` 会被排除。`resources/`、分析报告及 `assets/` 根目录的汇总文件也不属于这组打包目录。raw 排除规则同样适用于补丁、离线包和资源状态清单。

`latest.json` 指向最新发布清单，并携带当前资源状态文件的路径、SHA-256 和大小。

## 上传至 Cloudflare R2

确认构建结果与发布清单后，在配置好 `MASH_DATA_ROOT`、`R2_ENDPOINT` 和 `R2_BUCKET` 的终端执行：

```bash
npm run assets:deploy
```

| 环境变量 | 含义与默认值 |
| --- | --- |
| `R2_ENDPOINT` | R2 的 S3 兼容端点，必填 |
| `R2_BUCKET` | 目标桶，必填 |
| `AWS_PROFILE` | AWS CLI 配置名，默认 `mash`；显式设为空字符串时使用环境凭据 |
| `R2_PREFIX` | 对象前缀，默认 `mash` |
| `ASSETS_PREFIX` | 资源子前缀，默认 `assets` |
| `SOURCE_DIR` | 上传目录，默认 `$MASH_DATA_ROOT/dist/assets-release` |
| `CACHE_CONTROL` | 默认 `public, max-age=300` |

默认目标是 `s3://<桶>/mash/assets/`，保持本地发布目录结构。上传采用 `aws s3 sync`，同键对象可能被更新，本地缺失文件不会删除远端历史对象。

当前脚本同步整个目录，随后检查远端 `latest.json` 是否存在。它没有实现“先验证所有不可变对象，再最后切换 latest”的发布顺序，也没有逐对象回读校验。上传命令成功只表示完成当前脚本的这些步骤。

凭据通过本地 AWS 配置或环境变量提供，不写入仓库。数据及资源包的来源与许可说明见 [第三方来源与许可说明](../THIRD_PARTY_NOTICES.md)。
