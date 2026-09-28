# CSwitch

[下载最新版](https://github.com/BeiZi6/CSwitch/releases/latest) · [GitHub](https://github.com/BeiZi6/CSwitch)

本地 Anthropic 兼容网关。把第三方模型 API 转成 Claude Science 能用的 `/v1/models` 与 `/v1/messages`。对话客户端仍是 Claude Science；CSwitch 只负责配置、启停代理和 loopback 端点。

这不是 CSSwitch 的 Windows 移植，也不启动、停止或读取真实 `~/.claude-science`。

## Overview (English)

**CSwitch** lets Claude Science run on third-party model APIs. It starts a local Anthropic-compatible gateway and launches Claude Science against it with an isolated data directory, so your real `~/.claude-science` is never touched.

- **Problem:** Claude Science speaks the Anthropic Messages API, so teams on other providers cannot point it at the models they already pay for.
- **How it works:** a loopback-only gateway serves `/v1/models` and `/v1/messages` and translates requests, including SSE streaming, to Anthropic-compatible, OpenAI Chat Completions or OpenAI Responses upstreams. Science's Opus / Sonnet / Haiku / Fable picker maps to four upstream model IDs.
- **Built with:** Electron + TypeScript, a headless gateway mode for scripting, and 10 test suites covering the gateway, protocol translation, the Science launcher and the UI.
- **Status:** v0.1.6 installers for macOS (arm64 / x64), Windows (x64) and Linux (AppImage / deb) on [Releases](https://github.com/BeiZi6/CSwitch/releases/latest); not yet code-signed.

## 能做什么

- 三种配置：自定义 Anthropic、自定义 OpenAI Chat Completions，或自定义 OpenAI Responses
- 把 Science 里的 Claude Opus / Sonnet / Haiku / Fable 选择器映射到四个上游模型 ID
- 点「启动 Claude Science」：先开 loopback 网关，再拉起本机已安装的 Claude Science
- Science 使用隔离 data-dir，不读写真实 `~/.claude-science`

第一版不做：Skill/MCP 安装、Codex OAuth、系统 SSH。

## 开发

需要 Node 22+。桌面用 Electron。

```bash
cd /Users/xyu/CSwitch
npm install
npm test
npm run dev
```

无界面只跑网关：

```bash
CSWITCH_API_KEY=... CSWITCH_BASE_URL=https://api.deepseek.com/anthropic \
  npm run gateway -- --provider deepseek --model deepseek-chat
```

## 接到 Claude Science

1. 选择「自定义 Anthropic」、「自定义 OpenAI Chat Completions」或「自定义 OpenAI Responses」，填写 Base URL、API Key，以及默认 / 质量 / 快速 / Fable 四个上游模型。
2. 点「启动 Claude Science」。CSwitch 会启动网关，写入隔离虚拟登录，并用 `ANTHROPIC_BASE_URL` 拉起本机 `claude-science`。
3. 在打开的 Science 里选模型；列表显示的是你填的上游模型名，官方 Opus/Sonnet/Haiku 选择器也会映射到对应上游 ID。

Windows 会查找官方安装目录 `%LOCALAPPDATA%\Programs\ClaudeScience\claude-science.exe`，以及带空格的 `Claude Science` 变体和 PATH。找不到时设置 `CSWITCH_SCIENCE_BIN`。打包版会把隔离 data-dir 放在剩余空间更大的盘（通常是安装目录旁的 `sandbox`），避免系统盘空间不足。启动时会在隔离目录写入虚拟登录，Science 只把推理打到 loopback 网关。CSwitch 不会监听 `0.0.0.0`，也不会使用端口 `8765`。

## 下载

从 [GitHub Releases](https://github.com/BeiZi6/CSwitch/releases/latest) 获取：

- macOS：`CSwitch-0.1.6-arm64.dmg` / `CSwitch-0.1.6.dmg`
- Windows：`CSwitch_0.1.6_x64-setup.exe`
- Linux：`.AppImage` 与 `.deb`

当前包未做 Developer ID / Authenticode 签名。macOS 若拦截，请在 Finder 中右键选择打开。

## 打包

```bash
npm run pack:mac
npm run pack:win
npm run pack:linux
```
