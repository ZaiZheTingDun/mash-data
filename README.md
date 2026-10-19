# mash-data

为 Mash 提供的 FGO 数据处理工具：从 Atlas Academy 获取日服（JP）和国服（CN）数据，生成从者战斗形态、概念礼装及客户端资源，并提供数据检查和资源打包工具。

本仓库公开工具源码、测试和文档。运行时使用的数据、图片、更新游标和生成结果放在独立的数据目录中，由 `MASH_DATA_ROOT` 指定。维护者使用私有仓库 `mash-data-private` 管理这些内容；参与代码开发无需访问该仓库。

仓库中的 GitHub Actions 用于自动更新、构建和发布**官方 Mash 数据包**，由项目维护者运行。官方数据保存在 `mash-data-private`，发布产物上传至官方 Cloudflare R2 存储。

## 功能

- 根据 Atlas 数据版本和 Changes 日志更新从者详情，补齐缺失图片与概念礼装。
- 生成 JP/CN 从者战斗形态，收集技能切换依赖，汇总客户端所需 JSON。
- 检查形态技能的来源与元数据，生成目标选择、选项选择等分析报告。
- 构建基础资源包、增量补丁和离线导入包，并通过现有脚本上传至 Cloudflare R2。

## 官方 Mash 数据包的自动化构建与发布

现有 Actions 将官方数据维护分为两条独立流程：

| Action | 用途 |
| --- | --- |
| [Update private data](.github/workflows/data-update.yml) | 拉取官方 private 仓库，自动更新 Atlas 数据、客户端资源和 state，记录本次更改并提交回 private |
| [Release private assets](.github/workflows/assets-release.yml) | 基于官方 private 分支的最新提交，自动校验、构建数据包，并在启用发布时上传至官方 R2、更新发布入口 |

两条流程目前均由维护者从 `main` 手动触发，触发后的更新、构建和发布步骤自动执行。发布版本由 private 的 `assets/version.json` 管理；发布 Action 默认只构建校验，勾选 `publish` 后执行正式发布。

流程说明及官方发布环境的配置见 [官方 Mash 数据包构建与发布](docs/pipelines.md)。下面的快速开始面向工具源码开发和本地运行，代码开发无需配置官方发布凭据。

## 快速开始

### 环境要求

| 工具 | 用途 |
| --- | --- |
| Node.js 24 或更高版本 | 运行 TypeScript 工具 |
| pnpm 12 | 安装根工作区与 verification 依赖 |
| npm | 按独立锁文件安装 mash-atlasacademy 依赖 |
| Python 3 | 构建资源包，仅使用标准库 |
| Bash、AWS CLI | 上传 R2；构建增量补丁也需要 AWS CLI |

### 安装与本地检查

```bash
git clone https://github.com/ZaiZheTingDun/mash-data.git
cd mash-data
pnpm install --frozen-lockfile
npm --prefix mash-atlasacademy ci
```

两步依赖安装都需要执行：根工作区包含 `verification`，`mash-atlasacademy` 使用自己的 `package-lock.json`。

以下检查使用源码或临时测试数据，无需配置数据目录，也不需要私有仓库：

```bash
npm run typecheck:scripts
npm --prefix mash-atlasacademy run typecheck
npm --prefix verification run typecheck
npm --prefix mash-atlasacademy test
npm run verify:resources
```

`npm --prefix mash-atlasacademy run build` 可检查编译产物，输出位于该模块的 `dist/`。源码入口可直接运行，无需先编译。

### 配置数据目录

执行真实数据的下载、生成、检查或打包前，准备自己有权使用的数据目录，并设置环境变量。下面的路径仅为示例：

```bash
export MASH_DATA_ROOT=/absolute/path/to/mash-data-private
```

PowerShell：

```powershell
$env:MASH_DATA_ROOT = 'C:\path\to\mash-data-private'
```

推荐使用绝对路径。程序不会自动回退到代码仓库目录；部分入口还会检查数据根目录下是否存在 `assets/`。

数据目录的主要内容如下，具体输入取决于运行的命令：

```text
数据根目录/
├── assets/                  # Atlas 缓存、图片、汇总及发布版本配置
├── resources/               # 客户端资源 JSON
├── state/
│   └── atlas-data-version.json
├── verification/
│   └── result/              # 生成的分析报告
└── dist/                    # 资源包构建输出
```

完整流程面向已有完整数据目录的维护者，需要缓存、原始 JSON 和资源等输入。仅创建空 `assets/` 不足以运行所有步骤。本仓库不附带完整生产数据集；可先运行独立下载命令，了解其输出，参见 [Atlas 数据工具](mash-atlasacademy/README.md)。

从旧目录迁移时，将原 `mash-atlasacademy/data-version.json` 保留内容移到数据目录的 `state/atlas-data-version.json`。程序只读取新位置；缺少有效游标时会重新刷新对应地区的从者 JSON。

## 日常使用

以下命令均在代码仓库根目录执行，数据命令需先设置 `MASH_DATA_ROOT`。

```bash
npm start
```

完整流程依次执行：下载从者和礼装 → 下载技能切换依赖 → 生成并汇总 JP/CN 形态 → 检查形态并生成报告 → 汇总礼装 → 生成和同步客户端资源 → 更新形态技能目标差异报告。

| 命令 | 用途 |
| --- | --- |
| `npm run atlas:start` | 仅下载从者与礼装 |
| `npm run data:atlas` | 更新 Atlas 数据、生成汇总、检查形态并生成报告 |
| `npm run verify:variants` | 检查真实数据中 JP/CN 形态的技能来源、名称和图标元数据 |
| `npm run verification:generate` | 生成四类分析报告 |
| `npm run resources:generate-atlas-servants` | 生成 `resources/servants.json` |
| `npm run resources:sync` | 生成从者资源、复制形态与礼装汇总，再生成目标差异报告 |
| `npm run assets:offline-base` | 构建供手动导入的离线资源包 |

`data:atlas` 中的报告步骤会读取已有 `resources/`。下载、汇总和检查可以单独执行，但需满足各步骤的输入要求。`verify:all` 是报告生成命令的别名，并不运行所有测试。

更新策略见 [数据获取与缓存](docs/data-fetch-strategy.md)，完整打包与上传说明见 [资源构建与部署](docs/deployment.md)。

## 项目结构与文档

| 目录或文档 | 内容 |
| --- | --- |
| [mash-atlasacademy/](mash-atlasacademy/README.md) | Atlas 下载、缓存、战斗形态与汇总工具 |
| [verification/](verification/README.md) | 测试、数据完整度检查和分析报告 |
| [scripts/](scripts/) | 客户端资源生成、Python 打包和 Bash 上传入口 |
| [shared/](shared/) | TypeScript 工具共用的数据路径函数 |
| [数据获取与缓存](docs/data-fetch-strategy.md) | 增量更新、游标推进和失败重试行为 |
| [战斗形态数据格式](mash-atlasacademy/docs/servant-variants.md) | 字段含义、分组规则与运行时技能 |
| [资源构建与部署](docs/deployment.md) | 基础包、补丁、离线包与 R2 上传 |
| [官方 Mash 数据包构建与发布](docs/pipelines.md) | 官方数据更新、数据包自动构建与发布，以及维护者配置 |

TypeScript 的公共配置在根目录 `tsconfig.base.json`，根脚本和各模块的 `tsconfig.json` 在此基础上配置各自入口。

## 参与贡献

欢迎通过 [Issue](https://github.com/ZaiZheTingDun/mash-data/issues) 反馈问题或通过 Pull Request 改进工具与文档。反馈时请提供运行命令、Node.js 版本、预期行为和相关错误日志；数据问题尽量提供最小可复现输入。

提交代码前运行上面的本地检查；修改生成规则时，补充能够体现行为差异的测试，并说明是否使用真实数据验证。真实数据验证依赖自行准备的数据目录。请保留第三方来源说明，避免将生产数据、图片、凭据或生成报告提交到代码仓库。

## 许可证与致谢

项目原创工具代码和原创文档采用 [MIT 许可证](LICENSE)。感谢 [Atlas Academy](https://atlasacademy.io/) 提供数据接口和资源服务。

第三方数据、游戏文本、图片和依赖各自遵循其适用条款；项目的 MIT 许可证不覆盖这些内容。使用或分发生成的数据与资源包前，请阅读 [第三方来源与许可说明](THIRD_PARTY_NOTICES.md)。
