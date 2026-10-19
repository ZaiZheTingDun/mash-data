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
npm run resources:sync
```

首次运行会下载 JP/CN 完整礼装数据；后续运行按独立游标增量刷新，并从有效 raw 重建所有精简文件。最后一步还会同步从者资源与形态，需要已有完整数据目录。`combine:ces` 可以独立离线重建，但需要 raw 与两个地区的活动索引。

## 汇总格式

`craft_essences.json` 仍然是按 `collectionNo` 排序的数组，保留原有 `id`、`collectionNo`、`name`、`name_cn`、`rarity`、`flag`、`flags`。新增字段为：

```json
{
  "regions": {
    "JP": {
      "bondEquipOwner": null,
      "valentineEquipOwner": null,
      "bondBonuses": [],
      "events": []
    },
    "CN": null
  }
}
```

`regions.CN: null` 表示没有国服完整数据。地区对象存在且 `events: []` 表示当前 raw 没有提供明确活动关联，不能据此认定该礼装从未参与活动。JP/CN 独立提取，不使用日服效果填充国服缺失数据。如果仅有 CN raw，顶层基础信息取 CN 数据，`regions.JP` 为 null。

### 从者归属

`bondEquipOwner`、`valentineEquipOwner` 是 Atlas 内部从者 ID，无关联时为 null。使用 `resources/servants.json` 的 `id` 关联名称；礼装的 `collectionNo` 用于查找资源目录。

从者可以对应多张礼装，例如玛修有多张牵绊礼装。`buildCraftEssenceOwnerIndex(ces, region)` 提供反向查询辅助函数，返回按内部从者 ID 索引的 Map，每项包含 `bondEquipIds`、`valentineEquipIds` 两个内部礼装 ID 数组。客户端也可按汇总的 owner 字段筛选。

牵绊礼装归属与牵绊点数加成分别提取。“雪之城”具备牵绊礼装归属，其技能为毅力效果；归属字段不会自动生成牵绊点数加成。

### 牵绊点数加成

只从 `funcType: servantFriendshipUp` 提取 `bondBonuses`，每项对应一个技能的一个函数：

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

### 活动适用关系

`events` 为按 ID 排序、去重的 `{ id, name }` 数组，只读取以下明确来源：

- 属于该礼装的 `skillSvts[].eventId`；
- `extraPassive[].eventId` 及绑定/额外被动 `script.otherValidEventId`；
- `functions[].funcGroup[].eventId`；
- `svals`、`followerVals` 中的 `EventId`。

忽略 0 ID。活动名从该地区活动索引获取，无法解析名称时保留 ID，名称为 null。原活动与复刻保持不同 ID；技能描述、礼装名称和活动分类标记不用于推断活动。这里记录当前 raw 明确提供的加成适用关系，覆盖程度受上游保留的数据限制。

## 失败行为

raw 缺失或损坏时下载完整响应；仅精简文件缺失时从 raw 恢复。旧 basic 文件缺少 raw 时，离线汇总会提示先运行迁移命令。下载、解析、图片或活动索引失败时，该地区游标不推进；汇总失败时保留原有汇总文件。生产更新 Action 只有所有步骤成功后才提交 private 数据。
