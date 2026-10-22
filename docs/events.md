# 活动目录

活动目录从 JP/CN 的 Atlas `basic_event.json` 索引生成，不请求 `nice/event` 详情。更新从者和礼装的 `atlas:start` 会刷新 `state/atlas-events-jp.json`、`state/atlas-events-cn.json`；随后 `atlas:combine-events` 从这两份本地缓存合并生成目录，不访问网络。

```bash
export MASH_DATA_ROOT=/absolute/path/to/your-data
npm run atlas:combine-events
```

输出为 `assets/catalogs/events.json`，随 `assets-json` 基础包、增量补丁、离线包和资源状态清单发布，包内路径为 `catalogs/events.json`。JP/CN 两份源索引均缺一不可；索引缺失、为空或字段无效时保留旧目录并让命令失败。

```json
{
  "schemaVersion": 2,
  "events": [
    {"id":1,"type":"eventQuest","name":"日服名称","nameCN":"国服名称","warIds":[],"JP":{"noticeAt":0,"startedAt":10,"endedAt":20,"finishedAt":30},"CN":{"noticeAt":0,"startedAt":100,"endedAt":200,"finishedAt":300}}
  ]
}
```

示例仅说明结构。两服按相同 ID 合并，保留两服 ID 的并集，按 ID 升序排列，每条活动一行。以 JP 数据为基础，共用 `id`、`type`、`warIds`，`name` 为 JP 名称，`nameCN` 为 CN 名称；没有 CN 记录时 `nameCN` 为 null。仅 CN 存在时，顶层基础信息及 `name` 取 CN 数据。

四个时间字段分别保存在 `JP`、`CN` 中，缺失地区为 null。时间是 Atlas 原始 Unix 秒值，`0` 与远未来值原样保留，不推断活动是否正在进行。如果国服 `type` 或 `warIds` 与顶层不同，在 `CN` 内输出对应字段作为地区覆写；读取时优先使用地区覆写，再使用顶层值。

`type` 包含剧情活动、登录活动及各种强化活动，消费方可按用途筛选。`warIds` 仅表示源数据明确关联的章节，不代表完整关卡列表。这一步不包含横幅、活动商店、任务、奖励、抽奖和关卡详情。

## 活动道具与共用图标

`npm run atlas:download-event-items` 读取 JP/CN 的 `nice_item.json`，收录全部历史活动的以下五类道具：

| Atlas 类型 | 内容 |
| --- | --- |
| `eventItem` | 活动收集、兑换素材 |
| `eventPoint` | 活动积分 |
| `boostItem` | 活动加成道具 |
| `dice` | 桌游活动骰子 |
| `eventPassiveSkillGiven` | 赋予活动特效技能的道具 |

此命令已接入 `data:atlas` / `npm start`，每次刷新两服道具数据并补齐缺失图片，输出 `assets/catalogs/event_items.json`：

```json
{
  "schemaVersion": 2,
  "items": [
    {"id":94047704,"type":"dice","name":"ノーマルダイス","nameCN":"普通骰子","background":"silver","icon":"icons/items/94047704.png"}
  ]
}
```

道具按同 ID 合并，以 JP 元数据为基础，`name` 为 JP 名称，`nameCN` 为 CN 名称；不输出 `detail`。类型、底框、图标及 `missingIcon` 使用 JP 数据，没有 CN 记录时 `nameCN` 为 null。如果将来出现仅 CN 存在的道具，则保留该记录并使用 CN 元数据。记录按 ID 升序排列，每条一行。

`icon` 是相对 `assets/` 的路径。图片统一从日服 `Items` 下载到 `assets/icons/items/`，按源图片文件名去重；复刻活动中不同道具 ID 可指向同一图片。不额外下载国服图标。两服源图可能有像素差异，此共用策略用于界面展示，CV 识别效果需单独验证。

下载并发为 3，写入临时文件，成功后再改为正式文件名；失败临时文件会清理，再次运行跳过已有非空图片。Atlas 返回 HTTP 404 时保留道具，将 `icon` 设为 null，并用 `missingIcon` 记录日服源 URL，下次运行重新尝试。其他网络或文件错误使命令失败并保留旧目录。两服索引通过校验且图片处理完成后，才原子替换合并后的道具目录。

目录随 `assets-json` 发布，图标进入现有 `icon-images` 包；二者均进入增量补丁和离线包，无需新增包类型。包内目录路径为 `catalogs/event_items.json`，图标仍为 `icons/items/<文件名>`。

读取方使用 schemaVersion 2 的 `events` / `items` 数组和 `assets/catalogs/` 路径。
