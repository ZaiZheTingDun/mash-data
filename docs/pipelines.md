# 官方 Mash 数据包的自动化构建与发布

本仓库现有的 GitHub Actions 用于自动化维护和发布**官方 Mash 数据包**：先更新官方数据并提交到私有仓库，再基于已提交的数据自动校验、构建资源包，发布至官方 Cloudflare R2 存储，供 Mash 客户端获取。

两条 workflow 在公开的 `mash-data` 仓库维护，由项目维护者从 `main` 手动触发，后续步骤自动执行。数据更新与数据包发布独立运行，更新成功不会自动触发正式发布。本文中的 private 指官方数据仓库，必须通过 `PRIVATE_DATA_REPOSITORY` 指定，分支默认使用 `main`；GitHub 权限、凭据和 R2 配置面向官方数据包的发布维护者。

## 官方数据包的维护流程

1. 运行 **Update private data**，自动拉取 Atlas 数据、生成客户端资源、更新 state，并将数据与本次更改记录一起提交到官方 private 仓库。
2. 检查 private 中的更新提交和变更记录，设置并提交 `assets/version.json` 中的官方数据包版本。
3. 运行 **Release private assets**，读取 private 分支最新内容，自动校验并构建本次数据包。默认 `publish=false`，用于构建验证；正式发布时勾选 `publish`，自动上传、更新官方发布入口，再将已发布 manifest 提交回 private。

工具代码取本次 workflow 的 commit，数据取 private 指定分支的最新 commit，每次构建都记录实际使用的数据与工具版本。两条流程共用并发组，不同时更新或发布；已经运行的任务不会被新任务取消。GitHub 同一并发组只保留一个待执行任务，多次重复触发可能替换尚未开始的任务。

## 1. 更新官方数据：Update private data

入口：[data-update.yml](../.github/workflows/data-update.yml)。

1. 安装工具依赖，运行类型检查与临时数据测试。
2. 拉取 private 数据分支，沿用已有 `state/atlas-data-version.json`，不清空缓存或重置游标。
3. 补齐魔术礼装，运行 `npm start` 更新从者、概念礼装、runtime skill、variants 和客户端资源，再补齐技能图标。
4. 根据更新后的 resources 重新生成分析报告，检查资源分包是否齐全、JSON 是否有效、图片能否解码及已知图片/技能图标引用是否缺失。
5. 暂存 `assets/`、`resources/`、`state/`、`verification/result/` 的增删改，在 private 创建 `state/updates/<run-id>-<attempt>.json`。
6. 将数据和记录一起提交、推送回同一 private 分支。没有文件变化时不创建记录或空提交。

每条变更记录保存运行链接、工具 commit、更新前 private commit、JP/CN state 前后值、A/M/D 总数、`countsByResource` 分类数量以及完整文件路径清单。记录列出的文件不包含记录自身；需要查看具体字段差异时，对比该提交与父提交。

Update Action 的最终 summary 按资源类型列出**新增、修改、删除**数量，包括从者数据、从者原始 JSON、从者图片、战斗形态、概念礼装数据与图片、技能数据与图标、魔术礼装数据与图片、资源汇总、客户端资源、Atlas 游标和分析报告。统计单位是文件，JP/CN 文件分别计数；raw 和精简 JSON 单列，图片也单列。没有变化的类型显示 0；summary 不公开具体文件路径，详细清单保留在 private 的更新记录中。推送失败时仍展示本次分类统计，并明确标记推送失败。

任一步骤失败均不提交、不推送。下载器在图片、礼装、魔术礼装或图标下载失败时返回失败。各地区源 JSON 成功后仍按原规则推进 runner 本地游标；只有整条更新流程成功，数据和游标才一起进入 private。生成过程中失败的 runner 快照被丢弃，下次从 private 已提交的 state 重试。

推送使用普通 Git push。若运行期间有人推进 private 分支，推送会失败；不会 force push 或将生成结果自动 rebase 到另一份数据上，需重新运行。

更新流程不修改资源发布版本号、不上传 R2，也不自动触发发布。

## 2. 构建与发布官方数据包：Release private assets

入口：[assets-release.yml](../.github/workflows/assets-release.yml)。

1. 拉取 private 分支最新提交，并固定这次 checkout 的 commit。
2. 验证已提交的 variants、资源 JSON 和图片；不访问 Atlas，也不重新生成数据或推进 state。
3. 从 private 的 `assets/version.json` 读取目标整数版本，从 R2 的 `latest.json` 读取已发布版本。目标版本必须更大；版本由维护者在 private 中修改并提交。
4. 默认生成从 R2 当前版本到目标版本的 patch，保留已发布 base 和历史 patch 路线。从 R2 的上一版 manifest/state 读取历史对象校验信息和文件状态。
   选择 `base` 时，构建新基础包，同时生成从上一线上版本到本次版本的 patch，并在新 manifest 中保留历史 patch 链；空目标首次发布只构建 base。
5. `publish=false` 时只构建和校验，不写 R2。`publish=true` 时先上传版本化 ZIP、state、校验文件，再上传 manifest；所有引用对象均从 R2 S3 API 回读并校验大小和 SHA-256，最后切换 `latest.json`。
6. R2 发布及最终验证成功后，独立的 **Write published manifest to private** job 拉取 private 当前分支，将本次线上 manifest 写入 `assets/manifest.json`，单独提交并普通 push。该提交只包含 manifest，保留完整历史 patch、校验信息、state 引用和来源 commit。

workflow 输入：

| 输入 | 默认值 | 含义 |
| --- | --- | --- |
| `mode` | `patch` | patch 只构建增量包；base 构建新基础包，已有线上版本时同时构建本次 patch，并保留历史 patch 链 |
| `publish` | `false` | 勾选后才上传并更新 latest |
| `base_compatible` | `false` | 已有线上版本时，重建 base 必须确认受支持客户端兼容 |

pipeline 在 runner 内根据线上 manifest 生成本次清单，并在构建后恢复构建快照中的 `assets/manifest.json`，因此预览和失败的构建不会更改 private。生成的发布 manifest 带有 `source.dataCommit` / `source.codeCommit`，便于定位数据与工具版本。正式发布成功后才将完整清单回写 private，无需手工维护 patch 链；ZIP 等发布产物不提交到 private。

回写 job 使用 private 分支的最新提交作为父提交，只暂存 `assets/manifest.json`，不会覆盖数据、state 或 `assets/version.json`，也不要求 private 仍停留在构建使用的 commit。若期间已有新数据提交，manifest 记录本次已发布的数据快照，`source.dataCommit` 仍指向实际用于构建的数据 commit。写回前会核对线上 latest、本次发布版本和来源 commit；若线上版本已推进，或 private manifest 已指向更高版本，则拒绝回写，避免旧任务覆盖较新的发布记录。

R2 发布与 Git push 不能原子完成。回写推送失败时，线上版本已经发布，workflow 会明确显示“已发布、private 清单同步失败”，不会回滚 R2 或 force push。此时选择 **Re-run failed jobs**，只重跑回写 job，从 private 最新分支重新同步；不重新构建或发布数据包。若清单已经一致则跳过提交。GitHub 支持单独重跑失败 job，见 [官方说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)。

例如当前线上是 base v9、latest v14，发布 v15 并选择 `base`，将同时生成 base v15 和 `v14-to-v15.zip`，保留原有 patch 链。新安装可以使用新基础包，已安装旧资源的客户端可以沿保留的 patch 链更新；两类产物及其引用均校验完成后，才一起通过 latest 对外发布。

`base_compatible` 仍用于确认旧版 App 首次安装或重装时对新基础包的兼容性。当前客户端将更新目标限制为 App 内配置的资源版本；保留 patch 链解决的是已有资源的增量更新路径，不能单独保证旧版 App 使用新 base 的行为。

删除受管理文件时，需先在 private 提交与目标版本及实际删除清单完全一致的 `state/release-deletions.json`，例如：

```json
{
  "version": 15,
  "files": ["skills/123/skill.json"]
}
```

这是删除白名单，不能用一个开关放行未知缺失。缺少整类资源、损坏图片或缺失引用也会阻止发布。

已有线上版本但缺少 state 时，patch 和 base 发布都会失败，因为两者都需要构建本次增量包。必须恢复与该发布版本内容完全一致的 `states/asset-state-v<版本>.json`，并在其 latest 中提供正确的校验元数据，不能拿当前数据冒充旧状态。重建 base 不会自动跳过 patch 或删除历史更新链。

版本化对象通过 `If-None-Match: *` 创建，已有同键对象只在回读校验一致时复用，不覆盖不同内容。latest 通过准备阶段读取的 ETag 执行 `If-Match` 条件写入；首次发布用 `If-None-Match: *`。这也防止 Actions 以外的并发发布被覆盖。R2 支持这些条件写入，见 [Cloudflare 文档](https://developers.cloudflare.com/r2/api/s3/api/)。

上传或校验失败时，不推进 latest。保留同一份构建产物可重试未完成的上传；重新运行 workflow 会重新构建，ZIP 时间戳等可能变化。若前次已写入同版本对象，新产物不一致会失败，此时应使用新的 private 发布版本，不能覆盖已写入的对象。latest 成功切换后若最终回读失败，需检查线上实际状态，不应据此认定未发布。

版本化对象缓存一年并标记 immutable，latest 使用 60 秒缓存并要求过期后重新验证。上传验证通过 R2 S3 API，不以公共 CDN 缓存判断上传是否成功；实际客户端升级仍需单独验证。

## 官方发布环境配置

官方发布维护者在公开库创建 `data-update` 和 `assets-release` environments，部署分支限制为 `main`，并配置官方 private 仓库的访问凭据及官方 R2 目标。两者可配置相同的 repository variables：

| Variable | 用途 |
| --- | --- |
| `PRIVATE_DATA_REPOSITORY` | 必填，官方 private 仓库，格式为 `owner/repo`；未配置时 workflow 直接失败 |
| `PRIVATE_DATA_BRANCH` | 可选，默认 `main`；两条流程应指向同一分支 |
| `R2_ENDPOINT` | 发布必填，R2 S3 endpoint |
| `R2_BUCKET` | 发布必填，目标桶 |
| `R2_PREFIX` | 可选，默认 `mash` |
| `ASSETS_PREFIX` | 可选，默认 `assets` |

配置以下 secrets，可按用途放在对应 environment 内：

| Secret | Environment | 权限 |
| --- | --- | --- |
| `PRIVATE_DATA_WRITE_TOKEN` | `data-update`、`assets-release` | Fine-grained PAT，仅 private 仓库的 Contents read/write，用于更新数据和回写发布清单；两个 environment 均需配置，也可配置为 repository secret |
| `PRIVATE_DATA_READ_TOKEN` | `assets-release` | Fine-grained PAT，仅 private 仓库的 Contents read，用于 checkout |
| `R2_ACCESS_KEY_ID` | `assets-release` | R2 API 凭据，限目标桶读写 |
| `R2_SECRET_ACCESS_KEY` | `assets-release` | 对应 R2 secret access key |

公开库的 `GITHUB_TOKEN` 不能直接访问另一个 private 仓库，见 [checkout 官方说明](https://github.com/actions/checkout#checkout-multiple-repos-private)。公开库本身仅申请 `contents: read`；private 写权限来自专用 token。private 分支规则须允许该 token 所属账号提交数据变更。

两个 workflow 不执行 private 仓库内的脚本，只把它作为数据目录；不会上传 private checkout、更新记录或资源包为公开 Actions artifact。公开库的运行日志和 summary 仍可公开查看，summary 保存 commit、版本、按资源类型统计的数量及发布/回写状态，详细更改记录留在 private。

## 开发与本地验证

以下命令用于开发和检查构建工具；临时数据测试无需官方 private 仓库或发布凭据。新增 Python 校验器需要 Pillow；原有 `scripts/release.py` 打包器仍只用标准库。

```bash
python3 -m pip install -r scripts/requirements-pipeline.txt
python3 -m unittest discover -s scripts/tests -v
MASH_DATA_ROOT=/absolute/path/to/mash-data-private python3 scripts/validate_assets.py
```

配置 `MASH_DATA_ROOT` 和 R2 凭据后，可在**可丢弃的数据副本**上执行 `python3 scripts/pipeline_release.py prepare --mode patch`；它会清空数据副本下的 `dist/`。`publish` 子命令会真实发布，应仅在检查产物后执行。

这两条 workflow 使用新的 `pipeline_release.py` 发布入口；旧的 `assets:deploy` 仍为 [原有整目录同步脚本](deployment.md)，不具备这里的条件写入和逐对象验证流程。
