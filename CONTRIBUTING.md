# 参与贡献

欢迎在 [Issues](https://github.com/myricaRuba/spine-shelf/issues) 提交问题或功能建议，或通过 Pull Request 改进项目。

## 开始开发

使用 Node.js 24，执行 `npm ci`，然后运行 `npm run dev`。请先阅读 [第三方许可说明](THIRD_PARTY_NOTICES.md)；修改含有 Spine Runtimes 的产品时，MIT 许可不能替代上游要求的 Spine Editor 许可。

提交前运行：

```sh
npm test
npm run build
```

改动预览或桌面交互时，在有图形环境的 macOS 或 Windows 上运行相关的 `test:e2e`、`test:layout`、`test:classification` 或 `test:compat`。这些脚本使用独立临时资源库。兼容性测试首次运行会下载官方测试素材。

## 问题报告

请注明系统、CPU 架构、应用版本、Spine 导出版本、JSON/SKEL 格式和复现步骤。只有在你有权公开素材时才附上测试文件；不方便公开时，可以提供脱敏的目录结构、错误提示或最小复现资源。

## 提交约定

- 让一次改动解决一个具体问题，并说明如何验证。
- 不提交个人资源库、访问令牌、证书、日志、安装包或 `node_modules`。
- 保留第三方许可和版权声明，不把 Spine 官方内容重新标成 MIT。
- 原创代码和项目文档的贡献采用本仓库 MIT 许可；第三方文件继续遵循其原有许可。

## 发布

版本以 `package.json` 为准，界面自动读取该版本。同步更新 `package-lock.json` 和 `CHANGELOG.md`，完成检查后，在 macOS 执行 `npm run dist:mac`；在 Windows 执行 `npm run dist:win`（x64）或 `npm run dist:win:arm64`。也可在 Actions 中触发 `Desktop packages`，勾选 `draft_release` 后，工作流会在三个平台构建、验证并创建 Release 草稿与校验文件。确认构建结果后发布草稿；不要把安装包提交进 Git 历史。保留安装包内的 `licenses/`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`。

Windows 安装测试 `scripts/windows-installer-smoke.ps1` 仅允许在可丢弃的 CI 运行器上执行；它会安装、重装并卸载程序，验证开始菜单、打包资源与资源库保留。桌面测试可通过 `SPINE_SHELF_EXECUTABLE` 指向已安装的程序。图标已提交，Windows 开发无需执行依赖 macOS 工具的 `build:icons`。
