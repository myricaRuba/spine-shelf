# 参与贡献

欢迎在 [Issues](https://github.com/myricaRuba/spine-shelf/issues) 提交问题或功能建议，或通过 Pull Request 改进项目。

## 开始开发

使用 Node.js 24，执行 `npm ci`，然后运行 `npm run dev`。请先阅读 [第三方许可说明](THIRD_PARTY_NOTICES.md)；修改含有 Spine Runtimes 的产品时，MIT 许可不能替代上游要求的 Spine Editor 许可。

提交前运行：

```sh
npm test
npm run build
```

改动预览或桌面交互时，在有图形环境的 macOS 上运行相关的 `test:e2e`、`test:layout`、`test:classification` 或 `test:compat`。这些脚本使用独立临时资源库。兼容性测试首次运行会下载官方测试素材。

## 问题报告

请注明系统、CPU 架构、应用版本、Spine 导出版本、JSON/SKEL 格式和复现步骤。只有在你有权公开素材时才附上测试文件；不方便公开时，可以提供脱敏的目录结构、错误提示或最小复现资源。

## 提交约定

- 让一次改动解决一个具体问题，并说明如何验证。
- 不提交个人资源库、访问令牌、证书、日志、安装包或 `node_modules`。
- 保留第三方许可和版权声明，不把 Spine 官方内容重新标成 MIT。
- 原创代码和项目文档的贡献采用本仓库 MIT 许可；第三方文件继续遵循其原有许可。

## 发布

版本以 `package.json` 为准，界面自动读取该版本。同步更新 `package-lock.json` 和 `CHANGELOG.md`，完成检查后在 macOS 执行 `npm run dist:mac`。将安装包及其 SHA-256 校验文件上传到同名 `vX.Y.Z` GitHub Release；不要把安装包提交进 Git 历史。保留安装包内的 `licenses/`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`。
