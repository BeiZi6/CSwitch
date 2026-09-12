# Changelog

## 0.1.3

- 发布流水线改为串行上传，避免 Windows/macOS 安装包在 GitHub Release 里丢失

## 0.1.2

- 修复 Windows 安装包里桌面桥接未加载：保存配置时报 `Cannot read properties of undefined (reading 'status')`

## 0.1.1

- 补全 Linux `.deb` 所需的 maintainer 信息，完成三平台安装包

## 0.1.0

- 自定义 Anthropic 与自定义 OpenAI Responses 两种配置
- Science 的 Sonnet / Opus / Haiku / Fable 映射到四个上游模型
- 默认网关端口 `19191`（loopback，带 path secret）
- 启动时拉起本机 Claude Science，使用隔离 data-dir
- macOS / Windows / Linux 桌面包
