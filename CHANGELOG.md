# Changelog

本项目的全部显要的变更都记录在此文件

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)

## [Unreleased]

## [1.1.0] - 2026-09-11

### Added

- 新增 `labels` 配置：各字段渲染前缀可自定义为任意字符串、特殊符号或 Emoji；未配置、留空或写错键名的字段回落为字段名自身
- 新增 CHANGELOG.md 版本发布历史文件

### Changed

- 大幅度规范化代码：统一 JSDoc 元素注释与结构注释体系，全仓执行格式硬标准 (TAB 缩进、CRLF、注释标签、区域分隔线)

## [1.0.0] - 2026-09-11

### Added

- 首个可用版本：TPS / 词元 / 时延 HUD，渲染在 OpenCode 1.x TUI 会话提示行右侧
- 指标来自 OpenCode 公开事件流，支持 items 显示项与顺序、separator、精度、三档刷新、sts 文案表等配置
