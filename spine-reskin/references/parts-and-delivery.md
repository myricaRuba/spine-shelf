# 部件、静态预览与交付工具

这些工具要求 Python 3.10+、Pillow，与 `spine_reskin.py` 放在同一 scripts 目录。`spine_mesh.py` 是共享库，不直接运行。所有路径由参数传入，运行目录可任意选择。下文 `SKILL`、`WORK`、`ASSET`、region/skin/slot/attachment 都是示意值，应替换为本次实际值。新增输出目录必须不存在；除显式覆盖写回外，不改源资源。

## 参考图与裁切

```sh
python "SKILL/scripts/spine_parts.py" sheet --manifest "WORK/unpacked/manifest.json" --regions "region-a" "region-b" --columns 2 --cell 512 --scale 4 --out "WORK/reference"
python "SKILL/scripts/spine_parts.py" crop --manifest "WORK/unpacked/manifest.json" --image "WORK/generated.png" --layout "WORK/reference/layout.json" --out "WORK/cropped"
```

`sheet` 输出真实透明参考图与 `layout.json`，其中每项记录 region、参考画布尺寸和坐标框。省略 `--regions` 时包含所有区域。部件大于格子时拒绝生成，不自动缩放。

`crop` 按生成图的实际宽高换算参考坐标并缩到原逻辑尺寸，输出部件和 replacements 计划。它不检测生成模型是否移动了物体：这些是待检查的裁块，不能直接声称已对齐或全部替换完成。重新装回前只保留已经检查的 replacements 项。

## UV 覆盖

```sh
python "SKILL/scripts/spine_parts.py" coverage --manifest "WORK/unpacked/manifest.json" --region "region-a" --skin "skin-name" --slot "slot-name" --attachment "attachment-name" --image "WORK/part.png" --critical-box 12 24 28 40 --out "WORK/coverage"
```

输入必须是原 region 的裁剪逻辑尺寸，不是 orig 大画布。工具正确换算 atlas 的 orig/offset 与 mesh UV，并展开 linked mesh 父附件。一个 region 对应多个 mesh 时，必须显式指定 skin、slot、attachment，避免检查错绑定。

输出 `uv_mask.png`、`coverage_overlay.png` 和报告。覆盖率是对 alpha 达到 `--threshold`（默认 128）的像素做高分辨率采样；不包含网格变形或运行时检查。overlay 将越界部分标红，原尺寸数据不改动。

`--critical-box` 是**部件裁剪坐标**中的关键部位框。框应完整圈住手掌、指节或其他不能裁掉的部位；不是只圈住已经留下的部分。框为空或越界比例超过 `--max-outside`（默认 0.005）时拒绝通过。检查关键框与整部件报告，再查看原/新部件和组装图。

## 明确登记纹理

```sh
python "SKILL/scripts/spine_parts.py" align --manifest "WORK/unpacked/manifest.json" --region "region-a" --skin "skin-name" --slot "slot-name" --attachment "attachment-name" --image "WORK/generated.png" --mapping "WORK/mapping.json" --critical-box 12 24 28 40 --out "WORK/aligned"
```

`mapping.json` 示例（假设该部件实际逻辑高度为 96；不要直接套用这些坐标）：

```json
{
  "source_canvas": [1024, 1024],
  "source_box": [128, 96, 384, 480],
  "row_map": [[0, 0, 0], [24, 24, 0], [48, 50, 2], [96, 96, 0]]
}
```

- `source_canvas`：登记时的参考画布尺寸；生成图分辨率或 Real-ESRGAN 输出尺寸不同时，按此画布换算。
- `source_box`：这个部件在参考画布内的原坐标框。
- `row_map`：`[目标 y, 源 y, 源 x 偏移]`，均以该 region 的逻辑像素为单位，分段线性插值。源 x 偏移为正会把纹理往左移，源 y 大于目标 y 会把内容往上移。目标 y 必须递增并覆盖全高，源 y 必须单调。省略时原位登记。

观察原关节和新设计的肩部、肘部、手腕、手掌位置后再填写映射。它只支持沿 y 的登记与横向位移，不是通用非刚性配准或自动关节检测；大比例或方向错误应重绘，不能强行映射。不要仅根据可见包围盒拉伸。

默认 `--alpha generated` 保留新素材自己的透明边缘。仅在轮廓确实一致时用 `--alpha original`；不让旧轮廓露出黑底或邻近图集像素。`--min-alpha` 可按实际素材清理外部低透明度光晕，不是默认去黑边步骤。

`--clip-uv` 是可选的最后清理步骤；报告先计算未裁切的覆盖率，并先验证关键框。裁切不能修复超出网格的手掌。输出 `aligned.png`、覆盖图、报告与可供回填的 replacements 项。

## 静态组装图

```sh
python "SKILL/scripts/spine_preview.py" --manifest "WORK/unpacked/manifest.json" --skin "skin-name" --replacements "WORK/replacements.json" --background checker --out "WORK/setup-preview"
```

省略 replacements 时预览原部件。输出 `setup.png` 和 `report.json`。支持普通 region、未加权/加权 mesh、linked mesh、setup 插槽顺序与附件颜色；`--attachment "slot-name=attachment-name"` 可显式选择工具/武器等 setup 附件。`--scale` 控制预览像素，不更改资源。

仅绘制 setup pose。没有 walk 或其他动画采样功能，也不求解 IK、transform/path 约束；部分骨骼 transform 与非 normal 混合模式是近似。报告逐项列出限制。它用于快速检查纹理方向、黑边、关节接缝和明显裁切，不能替代用户实际 Spine 渲染器的动作验证。

## 校验与改名写回

```sh
python "SKILL/scripts/spine_delivery.py" verify --json "WORK/result/character.json" --atlas "WORK/result/character.atlas" --baseline-json "ASSET/character.json" --baseline-atlas "ASSET/character.atlas" --out "WORK/verified"
python "SKILL/scripts/spine_delivery.py" rename --json "WORK/result/character.json" --atlas "WORK/result/character.atlas" --name "character-newskin" --out "ASSET/character-newskin"
```

`verify` 检查附件引用、页面边界与几何元数据，并记录 JSON 字节是否相同以及全部语义差异。提供 baseline-json 且不提供允许路径时，任何语义变化都会拒绝。用户明确要求调整某字段时，可重复指定 `--allow-json-path "/exact/pointer"`；列表使用数字索引，键名中的 `/`、`~` 按 JSON Pointer 编码。选择最窄路径，不笼统允许整个 skeleton 或 animations。这个工具仅核验差异，不自动修改动画。

`rename` 完整复制 JSON、atlas 和所有 PNG 页，用新名称改文件名和 atlas 页面引用；JSON 字节与 region 名称不改，多页用 `_2`、`_3` 等后缀。新目录是默认方式，可直接将 out 指向用户要求的新皮肤目录。文件名仅支持可移植 ASCII 字母/数字、点、下划线、连字符。

已获用户授权更新现有皮肤目录时：

```sh
python "SKILL/scripts/spine_delivery.py" rename --json "WORK/result/character.json" --atlas "WORK/result/character.atlas" --name "character-newskin" --out "ASSET/character-newskin" --overwrite --backup "WORK/previous-skin"
```

备份目录必须不存在且位于目标目录之外。脚本仅更新这次明确生成的文件，保留目标内其他文件；失败时恢复已经更新的文件。源资源有哈希保护，禁止把源文件作为覆盖目标。写入权限仍遵循当前会话的授权与沙箱，不由技能扩大。
