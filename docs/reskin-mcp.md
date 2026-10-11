# Spine Shelf 换肤 MCP

资源信息中的「AI 换肤 → 开始制作」创建本地任务并直接启动 Codex。Codex 使用内置图片生成工具重绘、通过 MCP 提交，软件显示进度并刷新同一资源的皮肤列表。

## 直接制作

1. 在 ChatGPT / Codex 桌面版中使用 ChatGPT 账号登录，并保持应用为新版。
2. Spine Shelf 自动检测本机 Codex；状态显示「Codex 已就绪」后即可点击「开始制作」。
3. 等待软件显示「已添加」，点击「查看皮肤」。取消会停止后台进程；失败可以「重新制作」。

任务卡片显示本次已用时间、最近记录时间和当前工具操作。展开「制作详情」查看换肤要求和带时间的记录；「主要进度」显示 Codex 说明、提交结果与错误，「全部操作」还显示工具开始、完成、耗时和退出码。普通工具事件不会覆盖具体的阶段说明。记录保存在任务目录 `progress.json`，重开软件后仍可查看；重试保留先前记录，最多显示最近 500 条。旧版本可见消息会自动读入，原来没有时间的记录标记为「此前」。长时间无新事件时只提示等待，不推算完成百分比。

本机调用基于官方 [`codex exec --json`](https://learn.chatgpt.com/docs/non-interactive-mode)，以参数数组启动进程、通过 stdin 发送任务，解析 JSONL 进度；不使用剪贴板或模拟键盘。后台会话复用保存的 ChatGPT 登录与用户设置的模型/推理强度，不读取或转发登录令牌，不需要另填 API Key。使用 `--ignore-user-config` 限定此次会话的 MCP 为当前任务，已有全局配置保持原样。写文件范围为任务目录，库内写回由桌面 MCP 校验处理。管理策略和系统级权限仍由 Codex 执行。

软件优先检测本机桌面版自带 Codex，也支持 `SPINE_SHELF_CODEX` 指定可执行文件；自定义非 OpenAI 提供方目前不支持此图片制作通道。当前真实桌面验证平台为 macOS Apple Silicon。

后台会话显式选择 `default_permissions=":workspace"`，允许写入当前任务目录。Windows 同时传递原生沙盒模式，默认 `elevated`，用户全局设置为 `unelevated` 时沿用该值，避免忽略用户配置后丢失 Windows 沙盒设置。

后台任务使用单次执行令牌绑定 task ID。取消、退出或重试后，旧进程不能继续通过该 MCP 提交。重启时中断任务显示为可重试，已完成皮肤继续保留。`codex-events.jsonl` 保存有限的状态与可见消息，不记录原始命令输出、图片字节或思考过程。

## 删除与重新设计新增皮肤

动画预览的皮肤下拉框下方提供「重新设计皮肤」「删除皮肤」，资源信息的 AI 换肤区域也列出全部新增皮肤。原始皮肤保留，管理操作只针对软件新增的皮肤。

重新设计沿用名称，可从原版重新绘制，也可基于当前皮肤修正；表单带入该皮肤上次成功制作的要求。新任务包含 `replaceSkin`，同一个 `spine_reskin_apply` 在校验通过后替换旧皮肤；生成失败、取消、校验或保存失败都保留旧结果。项目引用和其他皮肤保持有效。一个角色仍只允许一个进行中的换肤任务。

删除前显示受影响的项目；确认后，项目默认皮肤与当前预览切回被删皮肤的基础皮肤。以它为基础的其他新增皮肤保留自己的贴图并更新基础关系。历史记录继续保留，但已删除或替换的旧版本不能通过「查看皮肤」再次出现。

旧皮肤在索引提交成功后归档到 `Library/.trash/skins/<操作 ID>/files`，`change.json` 保存操作前的元数据。中断归档会在启动时恢复；不能归档时保留原目录，避免损坏已保存的皮肤。此目录是本地恢复备份，当前没有一键还原界面。

`npm run test:skins` 使用隔离资源库和测试制作进程验证真实桌面按钮、MCP 替换、失败保留、删除、项目引用、衍生皮肤与原版像素一致性、重启持久化和可切换导出，不调用真实生图。

## 连接 Codex

直接制作会自行连接 MCP，无需手动配置。若还希望在普通 Codex 对话中管理任务，保持 Spine Shelf 1.3.0 或更新版本运行，使用以下全局 MCP 配置，把路径替换成实际绝对路径：

```toml
[mcp_servers.spine-shelf]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/spine-shelf/electron/mcp-server.cjs"]
tool_timeout_sec = 120
```

macOS 打包应用内自带 Node 环境，无需另装 Node：

```toml
[mcp_servers.spine-shelf]
command = "/Applications/Spine Shelf.app/Contents/MacOS/Spine Shelf"
args = ["/Applications/Spine Shelf.app/Contents/Resources/app.asar/electron/mcp-server.cjs"]
tool_timeout_sec = 120

[mcp_servers.spine-shelf.env]
ELECTRON_RUN_AS_NODE = "1"
```

Windows 可用安装目录中的 `Spine Shelf.exe` 及 `resources/app.asar/electron/mcp-server.cjs`，同样设置 `ELECTRON_RUN_AS_NODE=1`。测试配置可追加 `--data-dir /absolute/test/profile`。修改配置后在 Codex 的 MCP 设置中重启此服务器；使用当前会话尚未加载的新工具时，可重新打开 Codex。

配置字段参照 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。服务使用 [官方 TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) 的 stdio 传输，stdout 仅输出协议消息。

## 工具与制作流程

| 工具 | 用途 |
| --- | --- |
| `spine_reskin_status` | 检查应用连接、资源和待处理任务数量 |
| `spine_reskin_list_tasks` | 按资源或状态筛选任务 |
| `spine_reskin_get_task` | 获取用户要求、基础皮肤、PNG/图集/骨骼快照路径 |
| `spine_reskin_create_task` | 为用户指定的资源创建任务；表单也使用同一服务 |
| `spine_reskin_update_task` | 回报制作进度、失败或取消 |
| `spine_reskin_read_image` | 读取当前任务 source/result 中的 PNG |
| `spine_reskin_apply` | 校验图片、保存新皮肤并刷新当前资源 |

Codex 先读取指定任务，再按 `spine-reskin` 技能定位基础皮肤附件。通过 imagegen 重绘，保持区域位置、旋转、裁剪元数据、尺寸和 PMA，写入任务 `result/page-*.png`。超分是中间步骤，最终图片必须回到原图集尺寸。`result/texture.atlas` 已准备好，不需要修改。已有原生皮肤继续保留；新任务不清理其他皮肤引用的图块。

JSON 与 SKEL 使用各自匹配的运行库。软件用原生 `Skin.copySkin` 创建附件副本，网格保持与原网格、deform 动画的关联，只换纹理引用。可继续以刚生成的皮肤为基础制作下一套。

## 保存格式与范围

```text
Library/
  library.json
  ReskinJobs/<task-id>/
    source/                 原始快照，勿修改
    result/                 待提交的 PNG 和布局一致的 atlas
    asset-before.json       提交前资源元数据备份
  assets/<asset-id>/
    skeleton.json|skel      原骨骼文件，保持字节不变
    texture.atlas           原图集
    reskins.json            新皮肤名称、基础皮肤和图集路径
    reskins/<task-id>/      新皮肤的 atlas / PNG
```

新皮肤作为资源库的扩展数据持久化，由 Spine Shelf 在加载骨骼时添加为原生运行时 Skin。**这一步不会把新皮肤重新导出进原 JSON/SKEL 文件**；单独拿走原来的三件套不会包含这些新增皮肤。跨电脑恢复请备份整个 `Library`。供其他引擎直接导入的合并导出需要另行处理。

提交会检查源文件摘要、原图集布局、PNG 尺寸与真实像素变化；若原资源在制作期间变化，会拒绝过期结果。同一资源同时只能有一个进行中任务，完成任务重复提交不会重复添加皮肤。任务目录路径受限，所有资源库写入通过桌面应用的同一个队列执行。

桌面桥仅监听 `127.0.0.1` 的随机端口，连接描述符保存在用户数据目录 `spine-shelf-mcp.json`，包含每次启动更新的本机令牌。不要把这个文件放进版本库。MCP 关闭或软件未运行时会返回可读的连接错误。

## 验证

`npm test` 覆盖任务状态、原文件保留、过期结果和异常图片拒绝、路径边界、真实 stdio 往返。`npm run test:reskin` 使用独立临时库，验证 3.8 / 4.0 / 4.1 / 4.2 / 4.3 的 JSON 与 SKEL、皮肤切换、原皮肤像素恢复、动画及重启保存。兼容性素材首次运行前用 `npm run test:compat` 下载。

`npm run test:codex` 用明确标记的测试进程验证按钮到 MCP 写回。`SPINE_CODEX_REAL=1 npm run test:codex` 使用真实 Codex 登录与内置 imagegen，会消耗该账号的使用额度，需要预先准备 `artifacts/reskin-direct/probe/shield.png` 测试图片。真实测试只修改独立临时资源库。

测试生成的颜色变化仅用于临时素材校验，不是 AI 重绘结果。报告与界面截图保存在 `test-results/reskin/`。
