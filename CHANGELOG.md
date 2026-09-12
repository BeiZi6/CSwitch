# Changelog

## 0.1.5

- 修复 Windows 找不到官方安装：实际目录是 `%LOCALAPPDATA%\Programs\ClaudeScience`，不再只找带空格的 `Claude Science`；同时回退搜索 PATH
- Windows 打包版把 Science 隔离目录放到剩余空间更大的盘（安装目录旁），避免 `%APPDATA%` 所在系统盘空间不足时无法解压运行时
- Windows 上虚拟 OAuth 无法通过 claude.ai 校验，导致界面卡在 Switching organization；改为向 Science 注入本地 API Key，并清掉隔离目录里的假 OAuth / active-org，推理仍走 CSwitch 网关
- `/v1/messages` 始终按流式转上游并以 SSE 回给 Science，避免缺 `stream` 时整包同步返回
- 对照 CSSwitch：隔离 data-dir 写入虚拟 OAuth，Science 不再要求真实 Anthropic 登录
- `/v1/models` 改为 Science 可展示的 `claude-cswitch-*` 选择器，display_name 使用真实上游模型名，并保留官方 Opus/Sonnet/Haiku 角色映射
- 新增「自定义 OpenAI Chat Completions」，与 Anthropic / Responses 一样把 `/v1/messages` 转成上游协议

## 0.1.4

- 发布改为先收集三平台制品再统一上传，保证 Windows 安装包会出现在 Release 里

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
