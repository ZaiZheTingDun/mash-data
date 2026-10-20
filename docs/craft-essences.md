# 概念礼装数据

[返回首页](../README.md) · [更新策略](data-fetch-strategy.md) · [发布规则](deployment.md)

## 分层与迁移

数据路径均相对于 `MASH_DATA_ROOT`：

- `assets/ces/{collectionNo}/craft-essence-raw.json`、`craft-essence-cn-raw.json`：JP/CN 的完整 `nice/equip?lore=true` 响应。
- 同目录的 `craft-essence.json`、`craft-essence-cn.json`：从 raw 生成的精简文件，`schemaVersion` 为 1。
- `assets/craft_essences.json`：礼装汇总；`resources:sync` 将其复制到 `resources/craft_essences.json`。
- `state/atlas-ce-data-version.json`：礼装独立 JP/CN 更新游标。
- `state/atlas-events-jp.json`、`atlas-events-cn.json`：完整 `basic_event` 索引缓存，供活动名称解析使用。

raw 保存在 private，基础包、补丁包、离线包及资源状态清单均排除它们。精简文件保留原有基础字段和图片地址，移除完整技能树、剧情与成长曲线。

旧礼装文件来自 `basic_equip`，不能直接改名为 raw。设置好 `MASH_DATA_ROOT` 后，从代码仓库根目录执行：

```bash
npm --prefix mash-atlasacademy run start:ces
npm run atlas:combine-ces
npm run atlas:combine-events
npm run resources:sync
```

首次运行会下载 JP/CN 完整礼装数据；后续运行按独立游标增量刷新，并从有效 raw 重建所有精简文件。最后一步还会同步从者资源与形态，需要已有完整数据目录。`combine:ces` 可以独立离线重建，但需要 raw 与两个地区的活动索引。

## 汇总格式

`craft_essences.json` 仍然是按 `collectionNo` 排序的数组，每张礼装占一行以减少文件大小，同时保留可按礼装查看的差异。保留原有 `id`、`collectionNo`、`name`、`name_cn`、`rarity`、`flag`、`flags`。新增字段为：

```json
{
  "regions": {
    "JP": {
      "bondEquipOwner": null,
      "valentineEquipOwner": null,
      "bondBonuses": [],
      "qpBonuses": [],
      "eventBonuses": [],
      "events": []
    },
    "CN": null
  }
}
```

`regions.CN: null` 表示没有国服完整数据。地区对象存在且 `events: []` 表示当前 raw 没有提供明确活动关联，不能据此认定该礼装从未参与活动。汇总的 `events` 只保留 `{ id }`；活动名称保存在单张礼装文件的 `events` 中。JP/CN 独立提取，不使用日服效果填充国服缺失数据。如果仅有 CN raw，顶层基础信息取 CN 数据，`regions.JP` 为 null。顶层 `name`、`name_cn` 供现有 App 的礼装选择与搜索使用。

### 从者归属

`bondEquipOwner`、`valentineEquipOwner` 是 Atlas 内部从者 ID，无关联时为 null。使用 `resources/servants.json` 的 `id` 关联名称；礼装的 `collectionNo` 用于查找资源目录。

从者可以对应多张礼装，例如玛修有多张牵绊礼装。`buildCraftEssenceOwnerIndex(ces, region)` 提供反向查询辅助函数，返回按内部从者 ID 索引的 Map，每项包含 `bondEquipIds`、`valentineEquipIds` 两个内部礼装 ID 数组。客户端也可按汇总的 owner 字段筛选。

牵绊礼装归属与牵绊点数加成分别提取。“雪之城”具备牵绊礼装归属，其技能为毅力效果；归属字段不会自动生成牵绊点数加成。

### 牵绊点数加成

只从 `funcType: servantFriendshipUp` 提取 `bondBonuses`，每项对应一个技能的一个函数：

汇总只保留技能/函数 ID、`limitBreak`、`values` 和 `supportValues`；完整技能说明与函数级生效条件在单张礼装文件中。参数组自身的 `conditions`（例如 `EventId`）仍保留在汇总，便于按活动筛选。

| 字段 | 含义 |
| --- | --- |
| `skillId` / `functionId` | 源技能 / 函数 ID |
| `limitBreak` | 源 `condLimitCount`，0 为普通，4 为最大解放 |
| `detail` | 当前地区的技能说明，缺失为 null |
| `values` | 普通使用时的所有参数组，保留数组结构 |
| `supportValues` | 借用助战时的参数组；null 表示沿用 `values` |
| `conditions` | 技能解锁条件、礼装自身的技能绑定、extraPassive 以及函数目标/特性/关卡限制 |

每个参数组含 `percent`、`flat` 和 `conditions`：`percent = RateCount / 10`，例如 100 表示 10%；`flat = AddCount`。未提供的数值为 null。`conditions` 保存其余参数，例如 `Individuality` 和 `EventId`。函数条件保留 `functvals`、`overWriteTvalsList`、`funcquestTvals` 等源结构。

午餐时光普通/满破为 2%/10%；午茶时光为 1%/5%，助战为 3%/15%。多个条目不能直接相加：普通和满破可能互相替代，特性与关卡条件也需要由使用方判断。无法解析的牵绊数值会让生成失败。

从者精简文件的 `traits` 保留基础特性的 `{ id, name }`，客户端汇总 `resources/servants.json` 整体保留缩进换行，特性仅保留单行的纯 ID 数组，例如 `traits.JP: [203, 304]`，直接匹配数组中的 ID。精简文件中的名称沿用 Atlas 原值，例如 `{ "id": 304, "name": "alignmentEvil" }`。以“异星之神”（9408800）为例，其 `functvals` 为 304（恶）和 203（星属性），这张礼装在目标从者包含任意一个 ID 时生效。缺少地区特性数据时为 null，不能按“不符合条件”处理。形态覆写及带条件的额外特性见下节；它们不预先合并进基础特性。

### 量子（QP）加成

`qpBonuses` 从 `qpDropUp`（掉落 QP 提升）和 `qpUp`（结算 QP 增量）提取，结构与 `bondBonuses` 相同。保留普通／满破、助战专用参数和活动条件：`RateCount / 10` 写入 `percent`，`AddCount` 写入 `flat`。例如贝拉·丽莎普通／满破为 1%／5%，助战为 3%／15%。

单张文件保留完整说明与条件；汇总仅保存技能／函数 ID、`limitBreak`、`values`、`supportValues`。数据层同时保留百分比和固定值，客户端推荐可只选 `percent > 0`；带 `conditions.EventId` 的加成仅在对应地区活动有效期内推荐。没有 QP 加成为 `[]`，旧精简文件应通过 `combine:ces` 从 raw 重建后再发布。

### 从者形态与条件特性

从者精简文件还保留 `ascensionAdd.individuality` 和 `traitAdd`。客户端从者汇总新增：

| 字段 | 内容 |
| --- | --- |
| `traits.JP/CN` | 基础特性 ID 数组 |
| `traitOverrides.JP/CN` | `{ ascension, costume }` 形态覆写映射，各形态的列表为纯 ID 数组 |
| `traitAdd.JP/CN` | 条件特性数组，`trait` 为纯 ID 数组，保留 `idx`、`limitCount`、`condType`、`condId`、`condNum`、`eventId`、`startedAt`、`endedAt` |

缺少地区数据或对应源字段时为 null；已知没有条件特性时为 `[]`，已知没有形态覆写时映射为空。上游提供的空覆写数组也原样保留。

`traitOverrides.ascension` 的键是原始 `limitCount`（通常为 0..4），不是立绘编号或现有 variants 的 `ids`。`traitOverrides.costume` 的键是 `battleCharaId`，不是灵衣内部 ID。精简文件的 `profile.costume[battleCharaId].id` 保留两者对应关系；需要匹配条件特性的灵衣 `limitCount` 时使用该对应关系，不能直接拿 `battleCharaId` 比较。

使用方先确定当前再临/灵衣：存在非空的对应覆写时，使用该完整特性列表；否则使用基础列表。随后按源条件筛选 `traitAdd`，只有形态、关卡、活动及时间等条件满足时才加入相应特性。数据层保留这些条件，不在生成时将它们视作永久特性。

技能 variants 的分组不受特性变化影响：同一技能分组内仍可能有不同特性的再临或灵衣。判断礼装时应使用实际形态；当前形态或必要生效条件未知且可能改变结果时，应保留“无法确定”，不能把所有形态或所有活动特性合并。JP/CN 使用各自的数据，不互相回退。

### 活动适用关系

`eventBonuses` 保存明确关联到活动的礼装效果，每条对应一个技能函数参数和一个活动 ID。可按 `eventId` 对照同地区的 `events` 获取活动名；`limitBreak` 区分普通（0）和满破（4），同一效果的两档不能相加。`type` 包括 `dropCount`（掉落数量）、`dropAmountPercent`（掉落量百分比）、`points`（活动点数）、`damage`（活动伤害）、`enemyAppearance`（敌人出现率）和 `fortificationPoints`（活动进度）。`functionType`、`buffType` 保留 Atlas 的效果类型。

汇总中的每条 `eventBonuses` 只保留 `eventId`、类型、源技能/函数 ID、`limitBreak`、目标 ID、数值和动态标记。完整的 `detail`、`conditions` 与显示分组名称/图标在 `assets/ces/{collectionNo}/craft-essence[-cn].json` 中；需要显示加成详情或判断关卡、目标等生效条件时，按汇总的 `collectionNo` 读取对应地区的单张文件。两层数据均从同一份 raw 生成。

`flat` 为固定增量，`percent` 为百分数，例如 300 的 `RateCount` 或 1000 的伤害 `Value` 分别生成 30 和 100。活动点数决定威力的动态效果设置 `dynamic: true`、`percent: null`，需根据关卡状态计算。`targetId` 是源 `Individuality` ID，不是道具 ID；无法从 raw 稳定解析的材料名称不猜测。单张文件中的 `detail` 是本地区技能说明，`group` 保存对应活动的显示名称和图标，`conditions` 保存技能绑定、目标及其余参数，使用方需要按实际条件判断生效。JP/CN 各自提取。

加成的活动 ID 优先取参数里的 `EventId`，没有时取该礼装的技能绑定，最后才使用 `funcGroup` 的活动 ID。`funcGroup` 可能包含历史活动或复刻的显示配置；当参数已经给出 ID 时，不把其他显示配置当作同一条加成的适用活动。原有 `events` 仍汇集所有明确出现的活动 ID，因此它可能比 `eventBonuses` 的活动范围更广。

单张礼装文件的 `events` 为按 ID 排序、去重的 `{ id, name }` 数组，汇总投影为 `{ id }`，只读取以下明确来源：

- 属于该礼装的 `skillSvts[].eventId`；
- `extraPassive[].eventId` 及绑定/额外被动 `script.otherValidEventId`；
- `functions[].funcGroup[].eventId`；
- `svals`、`followerVals` 中的 `EventId`。

忽略 0 ID。活动名从该地区活动索引获取，无法解析名称时保留 ID，名称为 null。原活动与复刻保持不同 ID；技能描述、礼装名称和活动分类标记不用于推断活动。这里记录当前 raw 明确提供的加成适用关系，覆盖程度受上游保留的数据限制。

## 失败行为

raw 缺失或损坏时下载完整响应；仅精简文件缺失时从 raw 恢复。旧 basic 文件缺少 raw 时，离线汇总会提示先运行迁移命令。下载、解析、图片或活动索引失败时，该地区游标不推进；汇总失败时保留原有汇总文件。生产更新 Action 只有所有步骤成功后才提交 private 数据。
