<p align="center">
  <img src="public/brand/spine-shelf-logo.png" width="112" alt="Spine Shelf Logo" />
</p>

# Spine Shelf

**把 Spine 动画整理成一个可以随时浏览的本地素材库。**

中文桌面端 Spine 动画资源管理与预览工具。导入整个文件夹，自动识别骨骼、图集和图片，在本地保存、分类、搜索与预览，无需每次重新打开文件。

[下载 v1.0.0](https://github.com/myricaRuba/spine-shelf/releases/tag/v1.0.0) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/myricaRuba/spine-shelf/issues) · [参与贡献](CONTRIBUTING.md)

![Spine Shelf 桌面资源库与动画预览](docs/images/screenshot.png)

_截图使用 Esoteric Software 官方演示素材。_

## v1 功能

- **文件夹导入**：递归扫描子文件夹，识别 JSON / SKEL / SKEL.BYTES，配对 ATLAS 和多页贴图，重复内容自动跳过。
- **持久资源库**：保存完整本地副本，原始目录移动后仍可浏览；收藏、分组、标签和备注在重启后保留。
- **内容分类**：自动整理为人物、场景、普通素材和待分类，支持手动修正，与自定义项目分组互相独立。
- **动画预览**：选择动画和皮肤，播放、暂停、循环、调速、拖动时间轴、缩放、平移、水平翻转和显示骨骼。
- **截图导出**：将当前帧保存为透明 PNG。
- **浏览与整理**：搜索、格式筛选、排序、网格/列表切换；后台依次生成静态缩略图。
- **可调预览区**：拖动左边界调整宽度并自动记忆，双击恢复默认；悬停图标查看中文说明。
- **离线使用**：素材处理和分类均在本机完成，不上传素材到网络服务。

## 下载与安装

首个公开版本为 **v1.0.0**，提供 **macOS Apple Silicon（M 系列芯片）** 安装包：

1. 在 [Releases](https://github.com/myricaRuba/spine-shelf/releases/latest) 下载 DMG 文件。
2. 打开安装包，将 Spine Shelf 拖入「应用程序」。
3. 启动后导入文件夹，或将文件夹直接拖入窗口。

安装包目前没有 Apple Developer ID 签名或公证。如果 macOS 阻止首次打开，可在「系统设置 → 隐私与安全性」中允许打开。Release 同时提供 SHA-256 校验文件。

Windows 打包脚本已提供，但 v1 尚未验证 Windows 安装与运行，也不提供已验证的 Windows 安装包。

## 支持的素材

| 项目                              | 支持情况                                          |
| --------------------------------- | ------------------------------------------------- |
| Spine 导出版本                    | 3.8、4.0、4.1、4.2、4.3；按素材版本选择本地运行库 |
| 骨骼数据                          | JSON、SKEL，以及以 `.skel.bytes` 命名的二进制数据 |
| 纹理                              | `.atlas` 引用的常规图片，支持多页图集             |
| `.spine` 工程                     | 需先在 Spine 编辑器中导出，不能直接预览工程文件   |
| ZIP / 加密数据 / 游戏专有压缩纹理 | 暂不支持                                          |

建议的目录结构：

```text
角色素材/
  character.json      # 或 character.skel
  character.atlas
  character.png
```

导入器优先选择同目录同名图集，允许 `-pro` / `-ess` / `-pma` 等命名差异；只有一个图集时可以自动配对。多个候选无法明确匹配时会给出提示。重复检测比较骨骼、图集和图片的完整内容。

首次启动会加入四份标记为「演示」的官方示例；可以移除，也可从导入窗口重新加载。

## 自动分类如何工作

分类使用本地规则，综合骨骼、插槽、附件、动画、图集区域及素材名称。例如，肢体骨骼与跑步、攻击动作可作为人物线索；天空、地面、建筑图层可作为场景线索；边框、文字、按钮等名称可作为普通素材线索。

**这不是视觉 AI 分类。** 如果内部名称也都是编号或信息冲突，素材会进入「待分类」。SKEL 素材先使用图集和二进制名称线索，预览或缩略图解码后再用准确元数据补充分类。

在「资源信息 → 内容分类」中手动修正后，自动处理不会覆盖该结果。点击「恢复自动分类」解除锁定。左侧分类标题旁的按钮可重新整理整个库。

## 操作与快捷键

| 操作                | 用途                                   |
| ------------------- | -------------------------------------- |
| `⌘/Ctrl + O`        | 导入资源                               |
| `⌘/Ctrl + K`        | 搜索资源                               |
| `空格`              | 播放 / 暂停（焦点不在输入控件时）      |
| `F`                 | 适应画布                               |
| 鼠标滚轮 / 拖动画布 | 缩放 / 平移                            |
| 拖动预览左边界      | 调整并记住宽度                         |
| 双击预览左边界      | 恢复默认宽度                           |
| `Esc`               | 关闭弹窗、退出大预览或取消当前宽度拖动 |

分隔线也支持键盘：Tab 聚焦后用左右方向键调节，Shift 加速，Enter 恢复默认。按钮可通过 Tab 聚焦查看提示。

## 数据与备份

在「资源库设置」中查看实际存储位置。macOS 默认目录为：

```text
~/Library/Application Support/Spine Shelf/Library/
  library.json         # 素材索引、分类、分组、收藏、标签和备注
  library.json.bak     # 上一次成功写入前的索引备份
  assets/<uuid>/       # 每份素材的完整副本和缩略图
  .trash/<uuid>/       # 从库中移除的素材副本
```

退出应用后，复制整个 `Library` 文件夹即可备份。恢复时替换同名目录。索引原子写入，损坏索引不会被静默清空。移除素材不删除原始文件，库内副本暂存于 `.trash`。

仓库中只包含代码、品牌资源和官方演示素材，不包含用户导入的个人素材库。

## 本地开发

推荐 Node.js 24（最低 22.12）。

```sh
git clone https://github.com/myricaRuba/spine-shelf.git
cd spine-shelf
npm ci
npm run dev
```

`npm run dev` 会同时启动 Vite 和 Electron；仅在浏览器中打开页面无法使用本地资源库功能。

```sh
npm test                    # 导入、索引、分类、去重、迁移与持久化
npm run build               # TypeScript 检查和生产构建
npm run test:e2e            # Electron 真实预览、交互和重启
npm run test:classification # 分类筛选与手动修正
npm run test:layout         # 面板调宽、宽度记忆和按钮提示
npm run test:compat         # 5 个版本 × JSON/SKEL 的实际像素渲染
npm run package            # 本机架构 macOS .app
npm run dist:mac           # macOS DMG
npm run dist:win           # Windows NSIS，建议在 Windows 上构建和验证
npm run build:icons        # 在 macOS 从 Logo 母版生成各尺寸图标
```

桌面测试需要图形环境并使用独立临时资源库，不修改用户数据。兼容性测试首次运行会从官方 GitHub 下载素材至 `test-results/fixtures`。`SPINE_SHELF_DATA` 可指定独立用户数据目录。CI 执行单元测试与生产构建。

## 项目结构

```text
electron/     原生窗口、文件导入、本地索引、分类规则和受限 IPC
src/          React 界面、预览引擎和面板交互
public/       界面标识与旧版运行库
resources/    应用图标、Logo 母版及官方示例
licenses/     第三方完整许可文本
tests/        导入与分类测试
scripts/      开发、图标构建和桌面验证脚本
```

界面使用 React、TypeScript 和 Vite，桌面层使用 Electron。不同 Spine 运行库按需加载。渲染进程启用沙盒与上下文隔离；本地文件通过限定于应用和资源库目录的 `shelf://` 协议提供。

## 许可与致谢

**自写代码和项目文档采用 [MIT](LICENSE) 许可。Spine 官方运行库及示例素材保留各自许可，不属于 MIT 授权范围。**

使用、修改或分发包含 Spine Runtimes 的完整应用时，须同时遵守 [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license) 和适用的 [Spine Editor License Agreement](https://esotericsoftware.com/spine-editor-license)。本项目的 MIT 许可不能免除上游许可证要求。详见 [第三方声明](THIRD_PARTY_NOTICES.md)，其中列出组件版本、来源和完整许可文件。

感谢 [Esoteric Software / spine-runtimes](https://github.com/EsotericSoftware/spine-runtimes)、Electron、React 和 Lucide。Spine Shelf 是独立项目，与 Esoteric Software 无隶属或背书关系。

新 Logo 由内置 imagegen 生成，[母版](resources/brand/spine-shelf-logo-master.png)与[生成提示词](resources/brand/generation-prompt.txt)一并提供。
