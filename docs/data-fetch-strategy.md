# 数据获取与缓存策略

本文说明 `mash-data` 从 Atlas Academy 拉取 JP/CN 数据时，哪些步骤会获取完整索引、哪些文件会按版本刷新，以及哪些结果只在本地重新生成。

[返回项目首页](../README.md) · [Atlas 数据工具](../mash-atlasacademy/README.md)

本文中的数据路径均相对于 `MASH_DATA_ROOT`，命令从代码仓库根目录执行。运行真实数据流程前，先按首页准备数据目录和依赖。

## 更新范围

当前流程按数据类型分别处理：

1. 从者和概念礼装的轻量基础列表每次全量获取。
2. 从者与礼装详情使用独立游标，通过 Atlas 数据版本和 Changes 日志增量刷新；本地缺失或损坏的 raw 也会补齐。
3. 从者与礼装图片按文件存在性补缺，不覆盖已有图片。
4. runtime skill 对当前发现的依赖集合每次重新下载并覆盖。
5. variants、汇总文件、验证报告和 `resources/` 每次基于本地缓存完整重建。

| 数据 | 远端请求 | 本地判断 | 已有文件处理 |
| --- | --- | --- | --- |
| JP/CN 从者基础列表 | 每次获取完整 `basic_servant.json` | 用于确定当前 collection servant | 不单独落盘 |
| JP/CN 从者详情 | 读取 `/info`，版本变化时读取 Changes | Changes 关联、本地缺失、raw 缺失或 JSON 损坏 | 完整响应写入 raw，另生成精简缓存 JSON |
| JP 从者图片 | 根据从者详情逐项处理 | 检查目标路径 | 已存在则跳过 |
| JP/CN 礼装基础列表 | 每次获取完整 `basic_equip.json` | 遍历全部有效 `collectionNo` | 不单独落盘 |
| JP/CN 礼装详情 | `/info` 与 Changes；详情使用 `nice/equip?lore=true` | 礼装/技能/函数/Buff 变化、raw 缺失或损坏 | 写入 raw，每次重建精简 JSON |
| JP/CN 活动索引 | 每次获取 `basic_event.json` | 校验 ID 与名称 | 缓存至 `state/atlas-events-jp.json`、`atlas-events-cn.json`；本地生成 `assets/events/catalog.json` |
| JP/CN 活动道具 | 每次获取两服 `nice_item.json` | 收录五类道具、按图片文件名去重 | 刷新 `assets/events/items.json`，只补齐日服图标；404 显式标记并在下次重试 |
| JP 礼装图片 | 根据精简礼装的 `face` | 检查目标路径 | 已存在则跳过 |
| runtime skill | 请求全部已发现的依赖 ID | 不用已有技能文件跳过请求 | 每次覆盖 |
| variants、汇总和验证结果 | 不请求网络 | 扫描当前本地缓存 | 每次覆盖输出 |

## 主流程

仓库根目录的 `npm start` 依次执行：

```text
data:atlas
  ├─ 增量刷新从者、补齐从者图片
  ├─ 增量刷新概念礼装 raw、重建精简数据并补齐图片
  ├─ 从活动索引生成 JP/CN 活动目录
  ├─ 刷新 JP/CN 活动道具、补齐共用日服图标
  ├─ 覆盖下载 runtime skill 依赖
  ├─ 全量重建并汇总 JP/CN variants
  ├─ 运行完整度测试并生成 verification 报告
  └─ 全量重建概念礼装汇总

resources:sync
  ├─ 重新生成 resources/servants.json
  └─ 复制 variants、概念礼装汇总、活动目录和活动道具到 resources/
```

`resources:sync` 根据 `assets/` 中的缓存生成和复制资源，再生成形态技能目标差异报告，不访问 Atlas Academy。完整报告会读取已有 `resources/servants_variants.json`，因此 `data:atlas` 面向已有完整数据目录；各步骤输入见 [数据检查与分析报告](../verification/README.md)。

## 从者版本游标

JP 和 CN 的当前本地版本记录在：

```text
$MASH_DATA_ROOT/state/atlas-data-version.json
```

每个地区保存 Atlas `/info` 返回的 `hash` 和 `timestamp`。hash 是增量判断依据；timestamp 只用于记录和日志。

每个地区独立处理和推进游标：

1. 获取完整 `basic_servant.json` 和 `/info` 中的目标版本。
2. 检查基础列表对应的本地从者 JSON 是否存在、可解析且含有 `profile`。
3. 本地 hash 等于目标 hash 时不请求 Changes，只补齐缺失或损坏的 JSON。
4. hash 不同时下载该地区的 Changes JSONL，并只读取“本地 hash 之后、目标 hash 之前（含目标）”的记录。
5. 计算受影响的 collection servant，覆盖下载其 `nice/{region}/servant/{collectionNo}?lore=true`，完整响应写入 `*-raw.json`，再生成只含项目使用字段的缓存文件。
6. 该地区所有计划内 JSON 下载成功后，原子写入新 hash；失败时保留旧 hash。

JP 成功而 CN 失败时，只推进 JP。游标表示源从者 JSON 已更新到的版本；后续 variants 或报告生成失败不会回退游标，因为再次运行仍会从已经更新的 JSON 重新生成。

### Changes 如何关联从者

Changes 中的 `svt` 项带有 `collectionNo`，可以直接关联从者。但 Atlas 也会出现 `svt` 为空、只有 skill/NP/function/buff 变化的版本，因此不能只读取 `changes.svt`。

程序会从本地有效的精简从者 JSON 建立反向索引，覆盖：

- `skills`
- `noblePhantasms`
- 上述技能和宝具的 functions/buffs

Changes 中的 skill、NP、function 或 buff ID 命中索引时，对应从者也会进入刷新集合。无法关联到当前 collection servant 的敌方或活动实体只计入日志，不触发全量刷新，也不会调用 Atlas reverse API。

### 从者缓存精简

Atlas 的 `nice/servant?lore=true` 响应包含完整剧情、战斗效果和养成数据，每个地区分别保存两份：

- `servant-raw.json` / `servant-cn-raw.json`：未经裁剪的 Atlas 原始响应，仅作本地数据保留；
- `servant.json` / `servant-cn.json`：供生成、验证和资源发布使用的精简数据。

精简文件保留以下可消费字段：

- 从者的标识、名称、职阶、稀有度和基础分类；
- 基础特性 `traits`、`ascensionAdd.individuality` 中的再临/灵衣特性覆写，以及保留全部生效条件的 `traitAdd`；每个特性保留 `{ id, name }`；
- 卡面/头像/窄图和灵基图的 URL，以及灵衣对应关系；
- 技能、宝具的 ID、名称、图标、变体解锁条件、必要的目标类型/选择信息与增量更新依赖 ID；
- 宝具及从者名称覆写和 `SkillRankUp` 关系。

`classPassive`、`extraPassive` 和 `appendPassive` 不进入精简文件。对尚未转换的旧缓存运行 `npm run atlas:compact-servants`，会先保留为 raw，再生成精简文件。若 raw 已缺失，下一次 `npm start` 会重新请求对应 Atlas 数据补齐。

旧精简文件缺少基础特性、名称、形态覆写或条件特性而 raw 已有对应数据时，正常更新会从 raw 本地重建，无需重新下载。`resources/servants.json` 的 `traits.JP`、`traits.CN` 分别输出对应地区排序、去重后的纯特性 ID 数组；缺少地区数据或特性字段时为 null，已知空列表为 `[]`，国服特性不使用日服回退。汇总文件整体保留缩进换行，仅特性数字数组保持单行，直接用特性 ID 进行条件匹配；名称只保留在精简文件中，沿用 Atlas 原值（如 `alignmentEvil`）。`traitOverrides.JP/CN` 输出再临及灵衣的特性 ID 数组覆写，`traitAdd.JP/CN` 输出带条件的额外特性，其 `trait` 也只保存 ID 数组；这些数据不合并进基础 `traits`。编号、空值和生效规则见 [概念礼装条件所需的从者特性](craft-essences.md#从者形态与条件特性)。

raw 文件不会进入基础资源包、增量补丁或资源状态清单。

### 全量回退

以下情况无法安全计算增量区间，会对该地区的从者 JSON 做一次全量刷新：

- `state/atlas-data-version.json` 不存在、无法解析或缺少该地区版本。
- 本地 hash 不在 Changes 日志中。
- 本地版本位于目标版本之后，说明版本发生回退或历史被改写。

如果 `/info` 的目标 hash 尚未出现在 Changes 日志中，程序直接失败并等待重试，不推进游标。这样可以避免在两个 Atlas 资源尚未同步时漏过区间。

## 从者图片

JP 从者的卡面、头像和窄图仍只检查目标文件是否存在：

- 新路径不存在：下载，例如新增灵衣产生的新文件。
- 路径已存在：跳过，即使该从者 JSON 因版本变化被覆盖。

当前不比较图片哈希、修改时间、HTTP ETag 或 URL，也不强制覆盖同路径图片。CN 流程只保存从者 JSON，不下载单独的 CN 图片。

图片失败不阻止从者 JSON 游标推进；缺失图片会在下一次完整基础列表扫描时重试。

图片失败会让整体下载命令返回失败。CI 更新流程只有全部步骤成功才将数据与 state 一起提交到 private，失败时不会推送 runner 内已推进的游标。

## 概念礼装

礼装与从者采用相同的数据分层，使用独立的 `state/atlas-ce-data-version.json` 保存 JP/CN 游标。首次迁移时重新获取完整 `nice/{region}/equip/{collectionNo}?lore=true`，已有 basic JSON 不会被当作 raw。

- 完整响应保存为 `craft-essence-raw.json` / `craft-essence-cn-raw.json`，仅保存在 private，不参与发布。
- 每次运行都从 raw 生成 `craft-essence.json` / `craft-essence-cn.json`；精简文件缺失或格式升级不需要重新下载有效 raw。
- Changes 的 `ce` 项，以及命中礼装内部 ID 的 `svt` 项，触发直接刷新。技能、函数、Buff 反向依赖从完整 raw 建立，命中时刷新相关礼装。
- 游标缺失、本地版本不在历史中或版本回退时全量刷新；目标版本尚未进入 Changes 时失败等待重试。
- 该地区所有礼装生成、JP 图片补缺和活动索引写入成功后才推进游标。任何失败会让整体命令失败，保留该地区旧游标。
- JP 图片仍然只补缺，不覆盖已有图片。

`combine:ces` 从 raw 和本地活动索引重新生成精简文件与汇总，不访问网络。缺少 raw 的旧 basic 缓存会报错，避免汇总时静默丢失关联字段。字段和迁移命令见 [概念礼装数据](craft-essences.md)。

## runtime skill 与本地生成

`atlas:download-runtime-skills` 每次扫描本地 JP/CN 从者 JSON，递归收集 `script.SkillRankUp`，并覆盖写入：

- `assets/skills/{skillId}/skill.json`
- `assets/skills/{skillId}/skill_cn.json`

随后 variants、概念礼装汇总、verification 报告和 `resources/` 都从当前本地缓存全量重建。这些步骤不代表重新从 Atlas 下载所有源数据。

## 缓存清理与失败检查

当前不会自动删除本地目录：

- Atlas 当前基础列表中已经不存在的从者或礼装不会自动移除。
- 不再被从者引用的 runtime skill 目录不会自动移除。
- 汇总生成器仍可能扫描到有效的旧目录。

更新时应检查：

1. JP/CN 从者日志中的 `failed` 是否为 `0`，以及 hash 是否成功推进。
2. 图片和礼装下载阶段的失败计数。
3. runtime skill 下载、variants 完整度测试和 verification 报告是否完成。

子模块的 `download:skill-icons` 和 `download:mystic-codes` 不在根目录 `npm start` / `data:atlas` 主流程中，命令示例见 [Atlas 数据工具](../mash-atlasacademy/README.md)。

[官方 Mash 数据更新 Action](pipelines.md) 会额外执行这两个命令，为官方数据包自动补齐资源；图标收集包含 JP/CN 从者、魔术礼装和 runtime skill。礼装、魔术礼装及图标下载出现失败时，命令也会返回失败，防止 CI 提交不完整的更新。
