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

## 活动道具与共用图标

`npm run atlas:download-event-items` 读取 JP/CN 的 `nice_item.json`，收录全部历史活动的以下五类道具：

| Atlas 类型 | 内容 |
| --- | --- |
| `eventItem` | 活动收集、兑换素材 |
| `eventPoint` | 活动积分 |
| `boostItem` | 活动加成道具 |
| `dice` | 桌游活动骰子 |
| `eventPassiveSkillGiven` | 赋予活动特效技能的道具 |

此命令已接入 `data:atlas` / `npm start`，每次刷新两服道具数据，并补齐缺失图片。输出 `assets/events/items.json`，格式为：

```json
{
  "schemaVersion": 1,
  "regions": {
    "JP": [{ "id": 94047704, "type": "dice", "name": "ノーマルダイス", "detail": "…", "background": "silver", "icon": "icons/items/94047704.png" }],
    "CN": [{ "id": 94047704, "type": "dice", "name": "普通骰子", "detail": "…", "background": "silver", "icon": "icons/items/94047704.png" }]
  }
}
```

每服按道具 ID 升序排列，名称、说明和底框类型保留各自数据；`icon` 是相对 `assets/` 的本地路径。图片统一从日服 `Items` 下载到 `assets/icons/items/`，按源图片文件名去重，复刻活动中不同道具 ID 可指向同一张图片。不额外下载国服图标。两服源图片可能有像素差异，此共用策略用于界面展示，CV 识别效果需单独验证。

下载并发为 3，流式写入临时文件，成功后才改为正式文件名；失败临时文件会清理，再次运行跳过已有非空图片。Atlas 明确返回 HTTP 404 时保留道具，将 `icon` 设为 `null`，并用 `missingIcon` 记录日服源 URL，下次运行重新尝试。其他网络或文件错误使命令失败并保留旧目录。两服索引都通过校验、图片下载完成后才原子替换道具目录。

`resources:sync` 复制目录到 `resources/event_items.json`。发布时目录进入 `assets-json`，图标进入现有 `icon-images` 包，两者均进入增量补丁及离线包，无需增加包类型。
