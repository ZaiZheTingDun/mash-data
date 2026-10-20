# 活动目录

活动目录从 JP/CN 的 Atlas `basic_event.json` 索引生成，不请求 `nice/event` 详情。更新从者和礼装的 `atlas:start` 会刷新 `state/atlas-events-jp.json`、`state/atlas-events-cn.json`；随后 `atlas:combine-events` 从这两份本地缓存生成目录，不访问网络。

```bash
export MASH_DATA_ROOT=/absolute/path/to/your-data
npm run atlas:combine-events
npm run resources:sync
```

输出为 `assets/events/catalog.json`，`resources:sync` 同步一份至 `resources/events.json`。`assets/events/catalog.json` 也进入官方 `assets-json` 基础包和增量补丁。两个地区均缺一不可；索引缺失、为空或字段无效时保留旧目录并让命令失败。

```json
{
  "schemaVersion": 1,
  "regions": {
    "JP": [{ "id": 80632, "type": "eventQuest", "name": "復刻版:盈月剣風帖", "noticeAt": 1791968400, "startedAt": 1791968400, "endedAt": 1793764799, "finishedAt": 1794369599, "warIds": [9206] }],
    "CN": [{ "id": 80581, "type": "eventQuest", "name": "冠位戴冠战：暗匿者", "noticeAt": 1792044000, "startedAt": 1792044000, "endedAt": 1792648799, "finishedAt": 1792648799, "warIds": [] }]
  }
}
```

示例只展示格式；正式目录包含全部 JP/CN 记录。每个地区内按活动 ID 升序排列。时间是 Atlas 原始 Unix 秒值，`0` 与远未来值原样保留，不推断活动是否正在进行。`type` 是 Atlas 的原始活动类型：`eventQuest`、登录活动及各种强化活动都可能出现，列表消费方可按用途筛选。`warIds` 仅表示源数据明确关联的章节，不代表完整关卡列表。

这一步不包含横幅、活动商店、任务、奖励、抽奖和关卡详情；这些字段属于后续的 `nice/event` 及 war/quest 加载。
