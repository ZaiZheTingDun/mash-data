# Atlas Academy 数据工具

`mash-atlasacademy` 负责从 Atlas Academy 获取 FGO 日服（JP）和国服（CN）数据，维护本地缓存，并生成从者战斗形态与概念礼装汇总。当前主流程的上游数据来自 Atlas Academy。

[返回项目首页](../README.md) · [更新与缓存策略](../docs/data-fetch-strategy.md) · [战斗形态数据格式](docs/servant-variants.md)

## 开始使用

按 [项目首页](../README.md#快速开始) 安装 Node.js 24 与依赖。本文所有命令均从**代码仓库根目录**执行。

下载和生成命令需要设置 `MASH_DATA_ROOT`，输出写入该目录的 `assets/`，版本游标写入 `state/atlas-data-version.json`。单元测试自动使用临时数据，无需设置该变量。

```bash
export MASH_DATA_ROOT=/absolute/path/to/your-data
npm run atlas:start
```

该命令依次下载从者与概念礼装。它不执行形态生成、汇总或资源同步。

对于已有完整数据目录的维护者：

```bash
# 更新 Atlas 数据、生成汇总、检查形态并生成报告
npm run data:atlas

# 在上述流程后继续生成和同步客户端资源
npm start
```

完整流程和报告依赖已有数据，输入要求见 [数据检查与分析报告](../verification/README.md)。图标与魔术礼装的独立下载工具不在主流程内。

## 输出目录

下列路径均相对于 `MASH_DATA_ROOT`。数字仅示意目录结构，不代表固定的数据清单：

```text
assets/
├── servants/
│   └── 1/
│       ├── servant-raw.json           # JP 完整响应
│       ├── servant-cn-raw.json        # CN 完整响应
│       ├── servant.json               # JP 精简缓存
│       ├── servant-cn.json            # CN 精简缓存
│       ├── servant_variants.json      # JP 静态形态
│       ├── servant_variants_cn.json   # CN 静态形态
│       ├── card_servant_1.png
│       ├── face_servant_1.png
│       └── narrow_servant_1.png
├── ces/
│   └── 1/
│       ├── craft-essence-raw.json       # JP 完整响应，不发布
│       ├── craft-essence-cn-raw.json    # CN 完整响应，不发布
│       ├── craft-essence.json
│       ├── craft-essence-cn.json
│       └── card_ce.png
├── skills/
│   └── <skillId>/
│       ├── skill.json
│       └── skill_cn.json
├── servants_variants.json
├── servants_variants_cn.json
├── events/
│   ├── catalog.json                  # JP/CN 活动目录
│   └── items.json                    # JP/CN 活动道具，共用日服图标
├── icons/items/                      # 按源文件名去重的活动道具图标
└── craft_essences.json
```

下载从者详情时使用 `lore=true`，以保留 `profile.costume` 等形态生成所需字段。完整响应保存在 raw 文件中，精简缓存用于后续生成和资源发布；raw 文件不进入资源包。

JP 从者图片取自 `extraAssets.commands`、`faces` 和 `narrowFigure` 下的 `ascension` / `costume`。文件名后缀使用源字段的键：再临编号或灵衣 `battleCharaId`。礼装头像地址中的 `/Faces/` 会替换为 `/EquipFaces/`。CN 流程保存本地化 raw 和精简 JSON，复用 JP 图片。礼装数据格式、牵绊效果与归属字段见 [概念礼装数据](../docs/craft-essences.md)。

## 命令参考

除根目录已提供的快捷命令外，子模块命令统一使用 `npm --prefix mash-atlasacademy run <命令>`：

| 子模块命令 | 行为 |
| --- | --- |
| `start` | 依次下载从者和概念礼装 |
| `start:servants` | 更新 JP/CN 从者 JSON，补齐 JP 图片 |
| `start:ces` | 增量刷新 JP/CN 礼装 raw，重建精简数据、缓存活动索引并补齐 JP 图片 |
| `download:runtime-skills` | 递归下载 `script.SkillRankUp` 引用的完整技能数据 |
| `build:variants` | 根据本地 JP/CN 缓存生成每位从者的静态形态 |
| `combine:variants` | 汇总形态，并向对应槽位追加运行时技能 |
| `combine:ces` | 从本地 raw 与活动索引重建精简礼装及汇总 |
| `combine:events` | 从本地 JP/CN 活动索引生成活动目录 |
| `download:event-items` | 刷新双服五类活动道具，补齐共用日服图标，见 [活动数据](../docs/events.md) |
| `compact:servants` | 将旧缓存转换为 raw 与精简文件 |
| `download:skill-icons` | 单独下载技能图标 |
| `download:mystic-codes` | 单独下载魔术礼装数据与图片 |
| `typecheck` | 检查源码与测试的 TypeScript 类型 |
| `test` | 使用本地测试数据运行单元测试 |
| `build` | 编译源码与共享路径模块 |

单独重新生成形态时，先确保从者缓存和技能依赖已准备好：

```bash
npm run atlas:download-runtime-skills
npm run atlas:build-variants
npm run atlas:combine-variants
npm run verify:variants
```

编译输出位于 `mash-atlasacademy/dist/`，包含 `mash-atlasacademy/src/` 和 `shared/`。从仓库根目录运行编译后的下载入口：

```bash
node mash-atlasacademy/dist/mash-atlasacademy/src/index.js
```

## 更新行为

- 每次获取完整从者与礼装轻量列表。
- 从者与礼装详情使用独立地区游标，根据版本与 Changes 增量刷新，缺失或损坏的 raw 会补齐。
- JP/CN 游标分别在该地区计划内的从者 JSON 下载成功后推进。
- 图片按路径补缺；礼装精简数据每次从 raw 重建。
- 技能切换依赖每次覆盖下载，形态与汇总基于缓存重新生成。

重跑不会自动清理上游已移除的数据目录，也不会校验或覆盖同路径的已有图片。失败处理和全量刷新条件见 [更新与缓存策略](../docs/data-fetch-strategy.md)。

下载器已设置并发与间隔，例如从者默认并发为 3、每个工作线程的请求间隔为 300 毫秒。遇到限流时可降低并发或增加间隔，对应常量位于 [download-servants.ts](src/download-servants.ts) 与 [download-ces.ts](src/download-ces.ts)。
