# 自动化脚本

要求 Python 3.10+ 和 Pillow。若所选 Python 缺少 Pillow，使用该解释器安装 `python -m pip install Pillow`。下文的 `python`、`SKILL`、`ASSET`、`WORK` 是示意参数，执行时替换为实际解释器和目录，并为有空格的路径加引号；不保存任何固定机器路径。

`spine_reskin.py --help` 和各子命令的 `--help` 可查看参数。所有写入目录必须不存在，脚本完成后提交整个新目录，失败不会留下半套交付资源。源 JSON、atlas、PNG 不会被修改。

## 1. 检查与解包

```sh
python "SKILL/scripts/spine_reskin.py" inspect --json "ASSET/character.json" --atlas "ASSET/character.atlas" --report "WORK/inspect.json"
python "SKILL/scripts/spine_reskin.py" unpack --json "ASSET/character.json" --atlas "ASSET/character.atlas" --alpha pma --out "WORK/unpacked"
```

使用非 PMA 资源时改为 `--alpha straight`。这不是自动检测项；atlas 明确声明 `pma` 时，参数与声明冲突会拒绝执行。atlas 页路径相对于 atlas 所在目录，可包含子目录，不能越出资源目录。PNG 页面尺寸必须与 atlas 匹配。

输出 `manifest.json`、空的 `replacements.json` 和 `parts/<id>.png`。ID 避免 region 名称中的斜线或特殊字符造成文件路径问题。manifest 的 `parts` 保存 region 名称、图片路径、旋转和裁剪信息，`attachments` 保存所有 skin 中的引用及骨骼对应。

解包图是 **已恢复方向、裁剪后的 region 逻辑尺寸**，不是完整 orig 画布。offset 按 atlas 的左/下偏移保留，不因解包调整。`rotate:true` 按存储时逆时针 90° 处理，解包顺时针还原，回填逆时针恢复。数字 0/90/180/270 按同一方向约定处理。

保持导出 `parts` 原样，重绘结果另存于 `edits`，以便 `--keep-alpha` 读取原 alpha。manifest 内源路径由当前参数自动记录；移动源资源后重新解包，不手工拼接旧 manifest。使用前校验 JSON、atlas 和页面哈希，源资源变化会中止回填。

## 2. 选择替换图

编辑 `replacements.json`：

```json
{
  "replacements": [
    {
      "region": "exact/region/name",
      "image": "../edits/redrawn.png",
      "alpha": "straight"
    }
  ]
}
```

`image` 可以是绝对路径；相对路径基于 replacements 文件所在目录。只能填写 inspect/manifest 中真实存在的 region 名称，不能重复。输入图须带 alpha，且为 straight alpha；不要把 PMA 页面裁块直接作为替换图。

回填前人工检查新旧部件的关节与轮廓对齐。尺寸必须与 manifest 的 `size` 相同；显式加 `--resize` 才会做 Lanczos 缩放。这不会推断位置、构图或新 offset。

## 3. 原布局回填

```sh
python "SKILL/scripts/spine_reskin.py" replace --manifest "WORK/unpacked/manifest.json" --replacements "WORK/unpacked/replacements.json" --out "WORK/result"
```

可选 `--keep-alpha` 复用原轮廓；`--resize` 允许显式缩放。默认两项均关闭。JSON 和 atlas 逐字节复制，页面目录结构保留，仅修改选中区域。未修改的页面直接复制。共享或重叠矩形会拒绝原布局回填，避免意外修改其他 region，此时可用 repack 分开区域。

脚本不重建原图集的外部 padding；如果修改后边界颜色明显不同，优先 repack 重新生成边缘扩展，避免线性过滤采到旧的边缘颜色。

## 4. 可选单页打包

```sh
python "SKILL/scripts/spine_reskin.py" repack --manifest "WORK/unpacked/manifest.json" --replacements "WORK/unpacked/replacements.json" --padding 2 --max-size 4096 --out "WORK/packed"
```

不传 `--replacements` 可只合并原图集。输出原名 JSON、`reskin.atlas`、`reskin.png` 和 `report.json`。更换 atlas 文件名后由实际预览器选择对应文件。

保留所有区域的逻辑 size、orig、offset、rotate、index、split/pad；只更新页面名、页面尺寸和 xy。未编辑部件直接拷贝源像素，避免 PMA 往返产生量化变化。`--padding` 是每侧扩展像素数，相邻区域共有两倍 padding 的间隔。

只有确认当前 atlas 没有被其他 JSON 或外部 region 引用共享时，才加 `--prune-unused`。它按 **全部 skin 的附件引用** 删除未使用区域，不按待机帧判断，也不删除源文件。

只合并 format、filter、repeat、pma 声明一致的页面；repeat 非 none 时拒绝。shelf 打包会尝试若干宽度，不是最优求解器，放不下时提高 `--max-size` 或另用打包器；不自动放大像素、丢弃部件或修改骨骼。

## 5. 静态校验

```sh
python "SKILL/scripts/spine_reskin.py" validate --json "WORK/result/character.json" --atlas "WORK/result/character.atlas" --baseline-json "ASSET/character.json" --baseline-atlas "ASSET/character.atlas"
```

重打包时 atlas 改为 `WORK/packed/reskin.atlas`。`--baseline-json` 要求逐字节相同；`--baseline-atlas` 允许页面和 xy 变化、删除未引用区域，但剩余 region 的几何元数据必须一致。默认命令检查版本、所有纹理附件引用、linked mesh 父附件、PNG 尺寸、裁剪信息和越界。

`inspect` 和 `validate` 不是 Spine runtime，也不渲染动画。骨骼绑定、网格顶点与动画通过 JSON 字节不变保证未被工具改写；不因此宣称原始资源本身没有其他错误。

## 6. 可选 Real-ESRGAN

```sh
python "SKILL/scripts/spine_reskin.py" upscale --image "WORK/edits/redrawn.png" --exe "TOOLS/realesrgan-ncnn-vulkan.exe" --models "TOOLS/models" --model realesrgan-x4plus-anime --scale 4 --out "WORK/upscaled"
```

调用的是 `realesrgan-ncnn-vulkan` CLI，不自动下载工具/模型。路径可以在任意位置，模型名与倍率须由实际模型支持。默认超时 600 秒，可用 `--timeout` 更改。命令不经过 shell，路径中空格不会拆成多个参数。

输入使用 straight alpha（unpack 已统一）。脚本保存 RGB 临时输入，运行超分并检查退出码、输出存在性及倍率尺寸；输入可见区域非全黑但结果全黑时中止，不装回坏图。RGB 成功后按相同比例重采样原 alpha，输出 `upscaled.png` 和报告。实际观感仍需查看生成图。

如果最终回填目标仍是原 region 尺寸，先检查构图再显式下采样，或使用 replace/repack 的 `--resize`。不要通过这个开关声称图集已提高四倍分辨率；提高最终整套资源像素密度需要另行计算整套区域与裁剪元数据。

## 支持边界与依据

自动脚本处理 Spine 3.8.75 JSON（skins 数组）和 3.8 atlas 文本，PNG 页面，以及 rotate false/true/0/90/180/270。页上的 `pma: true|false` 原样保留。重复 region 名称、其他旋转角、非 PNG 页面或不识别的 atlas 字段会明确报错，不悄悄丢数据。SKEL 与 `.spine` 工程须先通过已有工具导出 JSON，脚本不转换它们。

脚本是独立实现，格式处理参照官方 [3.8 TextureAtlas](https://github.com/EsotericSoftware/spine-runtimes/blob/3.8/spine-ts/core/src/TextureAtlas.ts)、[3.8 SkeletonJson](https://github.com/EsotericSoftware/spine-runtimes/blob/3.8/spine-ts/core/src/SkeletonJson.ts) 和 [atlas 格式说明](https://esotericsoftware.com/spine-atlas-format)。某些官方 3.8 runtime 包明确拒绝版本字符串 3.8.75；本工具保留该字段，继续使用用户实际可用的预览器，不自动修改版本或替换 runtime。

支持上述元数据不代表任意 Spine 3.8 runtime 都能读取它们。保持用户已验证可用的渲染器，不把本工具当作 atlas/runtime 版本转换器。
