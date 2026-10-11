# AI 制作 Spine

在资源库或项目页点击「制作 Spine」，填写角色名称与外观需求，在「动作设计」表格逐行填写英文动作名称和中文动作内容。预置攻击 3 种、行走、出生、死亡、技能、静止、受击 2 种、退出，共 11 个动作；每行可编辑或删除，也可新增动作，最多 32 个。点击「开始制作 Spine」后，软件启动已登录的本机 Codex，通过内置图片生成工具制作透明部件，再用 MCP 提交骨骼动画。动作名称与内容会逐项写入任务和后台制作提示。表单自动保存，过程可查看记录、取消或失败后重试；关闭面板不会取消任务，退出软件会中断任务。

若界面提示「制作功能已更新」，请完全退出并重开软件以更新后台接口。已填写表单在重开后保留。

输出 **Spine 4.2 JSON + atlas + PNG**。支持透明 region 部件、加权 mesh、父子骨骼及长度、单/双骨骼 IK、旋转/平移/缩放与 IK 混合关键帧，以及 Bezier 缓动。暂不生成 Spine 编辑器的 `.spine` 工程，不支持物理约束或独立 deform 时间线。成品作为新资源加入资源库，可加入项目后导出。

制作流程先规划关节、承重、网格权重和关键姿势，再生成部件并绑定。行走需要区分落地支撑和抬脚回摆；骑乘需要建立鞍座与骑士的运动关系；披风和尾巴需要延迟跟随。按需要使用网格与 IK，数量不是质量指标。提交前可编译独立预览，逐帧查看动作以及骨骼网格。运行库检查只能证明结构与数值有效，不能代替视觉验收。

## MCP 工具

使用现有 `spine-shelf` 全局 MCP 配置即可。更新软件和 MCP 进程后会出现：

| 工具 | 功能 |
| --- | --- |
| `spine_generate_create_task` | 创建制作任务，要求 name、prompt；animationRequirements 是 `{name,description}` 数组，兼容旧 animations 名称列表；省略时使用 11 个预设。MCP 创建后由当前对话完成制作 |
| `spine_generate_list_tasks` | 查询任务记录 |
| `spine_generate_get_task` | 获取要求、result 路径、manifest 示例与格式说明 |
| `spine_generate_update_task` | 汇报进度、失败、重试或取消 |
| `spine_generate_read_image` | 查看 result 中的 PNG |
| `spine_generate_preview` | 编译并返回离线预览 HTML，支持动作切换、时间轴、慢放、骨骼网格；不导入或完成任务 |
| `spine_generate_apply` | 编译、验证并导入一个新 Spine 资源；重复成功提交返回同一资源 |

界面创建任务会自动启动 Codex。软件启动的后台 MCP 仅暴露该类任务的工具，绑定 task ID 和单次 run ID。取消、重试或退出后，旧进程不能提交结果。

## 生成文件

每个任务位于用户数据目录 `Library/GenerationJobs/<task-id>/`。把透明部件 PNG 和 `rig.json` 写到 `result/`；不要写资源库索引。文件名仅允许英文字母、数字、下划线、短横线和 `.png` 后缀。示例格式由 `get_task` 返回。

`rig.json` 包含：

- `bones`：父级先于子级；字段为 `name`、`parent`、`x`、`y`、`rotation`、`length`。
- `parts`：由后到前的绘制顺序；字段为 `name`、`bone`、`file`、`x`、`y`、`rotation`、`width`、`height`、可选 RGBA `color` 与 `mesh`。位置表示图片中心相对骨骼的位置，宽高默认采用图片像素尺寸。
- `ik`：可选约束列表 `{name,bones:[parent,child],target,bendPositive?,mix?,softness?}`，支持一根或两根骨骼。链需正长度；双骨骼链需直接父子，子骨骼 `x > 0,y = 0`，链首不可为根骨骼。目标需独立于受约束链。
- `animations`：动作名到 `{loop?,bones:{骨骼名:{rotate,translate,scale}},ik?:{约束名:[帧]}}` 的映射；旋转帧为 `{time,value}`，位移/缩放帧为 `{time,x,y}`，IK 帧为 `{time,mix?,softness?,bendPositive?}`。

时间线帧可带 `ease: [x1,y1,x2,y2]`，使用归一化 Bezier，如 `[0.42,0,0.58,1]`。编译器转换为 Spine 4.2 每个数值通道的绝对时间/值控制点。省略则线性，`ease:"stepped"` 为阶梯。

`mesh` 包含 `vertices:[{x,y,u,v,weights:[{bone,weight}]}]` 和 `triangles:[i0,i1,i2,...]`。顶点 x/y 是以图片中心为原点、Y 向上的显示像素坐标；先经过 part 旋转和平移，再经过骨骼设置姿态变换。u/v 是纹理归一化坐标（左上为 0,0）。每顶点 1–4 个正数权重，和为 1；编译器按未施加 IK 的设置姿态计算各骨骼绑定坐标。每个顶点需参与非退化三角形。刚性部件保持刚性，权重混合集中在关节；柔性部件按变形需要布线。

坐标使用像素，Y 向上，角度使用度，时间使用秒。每条时间线从 0 开始且严格递增，最长 30 秒，至少两帧、最多 120 帧。每个动画最多 4096 个不同关键帧时间。循环动作声明 `loop:true`，需首尾衔接。每个任务最多 120 根骨骼、60 个部件、32 个动作；单个部件不超过 2048×2048，图集不超过 4096×4096；每个 mesh 最多 2048 顶点，合计最多 16000 顶点。

提交时检查路径、PNG、透明度、骨骼与 IK 引用、网格拓扑和权重、动作名称、关键帧和运行库加载。官方 4.2 运行库在关键帧与均匀时间点采样，检查骨骼和网格坐标是否有限；声明循环的动作检查首尾世界顶点误差小于 0.1 像素。它不能自动判断速度接缝、脚滑、碰撞、解剖和主观美术质量。格式参考 [Spine 官方 JSON 文档](https://en.esotericsoftware.com/spine-json-format)，具体字段由项目固定的 4.2 运行库验证。

## 验证

`npm test` 包含编译、导入、重复提交、失败结果、取消后提交和重启恢复测试。`npm run test:generation` 在独立资源库中验证界面 → 测试 Codex 进程 → MCP → 编译 → 动画预览与记录持久化。

设置 `SPINE_GENERATION_REAL=1` 后运行 `npm run test:generation` 会用真实 Codex 和一次内置图片生成制作小机器人，消耗账号额度，结果保存在 `test-results/generation-real/`。测试使用独立临时资源库，不修改日常素材。
