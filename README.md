# my-opencode-tps-tui1

OpenCode 1.x TUI 的指标 HUD，渲染在会话提示行右侧

```
TPS 60.3 | AVG_TPS 104 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 9s | AVG_TTFT 10s | DUR 2m57s | TOTAL_DUR 26m45s | STS Waiting...
```

仿造 `opencode-tps1` 与 `opencode-tps-meter` 两个插件，取各自实现里更优的部分重写

---

## 一、本插件用途

在 OpenCode 会话提示行右侧显示一行实时指标：吐字速度 (TPS)、词元用量 (TOKEN)、首字时延 (TTFT)、耗时 (DUR) 与会话状态 (STS)。指标来自 OpenCode 公开事件流，无需额外配置模型或接口

特点：

- 数据齐全，显示项目、显示顺序、显示前缀文本 (标签)、组件分隔符等要素，都灵活可配置，显示权完全交给用户
- 单次对话结束不清零，用户挂机回来看到的是一行完整摘要数据，而不是空占位符
- 会话忙时耗时逐秒增长，实时关注耗时情况，单次对话结束结算时冻结耗时数据
- 整行单块渲染，拖拽选中时看到的文本是完整一块，模块之间使用字符作为分隔符，分布均匀

---

## 二、安装与注册

**npm 包注册** (包发布到 npm 后可用)：

```jsonc
{
	"$schema": "https://opencode.ai/tui.json",
	"plugin": [
		"my-opencode-tps-tui1@latest"
	]
}
```

**本地开发方式一：缓存 JUNCTION** (插件真身留在本地仓库，不依赖 npm 发布)：

在仓库 `scripts\` 下执行 `relink.cmd` 建立缓存 JUNCTION (缓存被清后重跑一次即可恢复)，之后同样按上面的裸包名注册

**本地开发方式二：本地绝对路径** (不建 JUNCTION，代价是换设备要改路径)：

```jsonc
{
	"plugin": [
		["file:///<你的插件仓库路径>/tui.tsx", {}]
	]
}
```

重启 TUI 生效，OpenCode 目前不热重载插件

WARN 入口固定为原始 `tui.tsx`，不要配预编译产物；具体原因与安装落点实测见 [docs/install-and-loading.md](docs/install-and-loading.md)

---

## 三、插件配置

插件选项走 `tui.json` 的 `[spec, options]` 元组

```jsonc
{
	"plugin": [
		[
			"my-opencode-tps-tui1@latest",
			{
				"items": ["TPS", "AVG_TPS", "TOKEN", "TOTAL_TK", "TTFT", "AVG_TTFT", "DUR", "TOTAL_DUR", "STS"],
				"labels": {
					// "TPS": "TPS",              // NOTE 不做修改，显示字段名自身
					"AVG_TPS": "AVG",             // NOTE 修改前缀为其他的英文单词
					"TOKEN": "✪",                // NOTE 修改前缀为特殊符号
					"TOTAL_TK": "总词元数",       // NOTE 修改前缀为别的中文单词
					// "TTFT": "TTFT",
					// "AVG_TTFT": "AVG_TTFT",
					"DUR": "⏱️",                 // NOTE 修改前缀为Emoji符号
					// "TOTAL_DUR": "TOTAL_DUR",
					// "STS": "STS"
				},
				"separator": "|",
				"countPrecision": 4,
				"secondPrecision": 0,
				"scope": "turn",
				"liveEstimate": true,
				"hideEmpty": false,
				"emptyText": "0",
				"colorize": true,
				"refreshLiveMs": 500,
				"refreshCountMs": 1000,
				"refreshClockMs": 1000,
				"toastOnComplete": false,
				"sts": {
					"idle": "Ready",
					"waiting": "Waiting...",
					"streaming": "Streaming...",
					"retrying": "Retrying #{n}...",
					"error": "Error",
					"unknown": "-"
				}
			}
		]
	]
}
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `items` | 全 9 项 | 汇总「显示哪些」与「显示顺序」，会自动去重、丢弃未知字段，空数组回落到全展示 |
| `labels` | 字段名自身 | 各字段渲染时显示的前缀文本：键为 `items` 字段名，值为任意字符串 (英文 / 中文 / 特殊符号 / Emoji 均可)；未配置、留空或写错键名的字段回落为字段名自身 |
| `separator` | `"\|"` | 字段间分隔符 |
| `countPrecision` | `4` | `TOKEN` / `TOTAL_TK` 缩写后最多保留的小数位 |
| `secondPrecision` | `0` | 纯秒档小数位；默认 `0` 即整秒展示 (`5s`)，想要 `8.5s` 写法设 `1` |
| `scope` | `"turn"` | 单次读数的口径，`turn` = 一轮对话聚合，`message` = 最近一条消息 |
| `liveEstimate` | `true` | 是否显示流式过程中的实时 TPS |
| `hideEmpty` | `false` | 无数据字段是否整段隐藏；默认不隐藏，用 `emptyText` 占位，整行宽度稳定 |
| `emptyText` | `"0"` | `hideEmpty=false` 时无数据字段显示的占位文本 |
| `colorize` | `true` | 会话忙时整行高亮为主题强调色，静止回落灰色 |
| `refreshLiveMs` | `500` | 实时档采样间隔 (`TPS` / `STS`) |
| `refreshCountMs` | `1000` | 计数档采样间隔 (`TOKEN` / `TOTAL_TK` / `AVG_*`)，嫌数字跳可调大 |
| `refreshClockMs` | `1000` | 时钟档采样间隔 (`TTFT` / `DUR` / `TOTAL_DUR`)，固定 1 秒让耗时逐秒可见 |
| `toastOnComplete` | `false` | 回答结束时额外弹一条 toast |
| `sts` | 见上 | STS 文案表，可逐项覆盖 |

---

## 四、插件显示指标一览

| 字段 | 含义 |
|---|---|
| `TPS` | 最近 5 秒实时吐字速率，空闲后回落到本轮均值 |
| `AVG_TPS` | 会话累计词元 ÷ 累计生成时长 (排除工具停顿) |
| `TOKEN` | 本轮输出词元 (流式中按字节实时估算，完成后由权威值接管) |
| `TOTAL_TK` | 会话累计输出词元 |
| `TTFT` | 本轮首字时延，首个流式增量到达即确定 |
| `AVG_TTFT` | 各轮 TTFT 的算术平均 |
| `DUR` | 本轮耗时 (忙时逐秒增长、结算冻结) |
| `TOTAL_DUR` | 各轮耗时之和 |
| `STS` | 会话状态：Ready / Waiting... / Streaming... / Retrying #n... / Error |

各字段精确口径、空闲不清零策略与设计决策记录见 [docs/metrics-and-render.md](docs/metrics-and-render.md)

---

## 五、插件自检工具 (开发用)

自检脚本依赖 [bun](https://bun.sh) 运行时

```bash
bun run selftest    # 纯逻辑：格式化分档 + 事件流模拟 + 配置归一化
bun run loadtest    # 加载级：现编 tui.tsx 产物 + 桩件实跑事件流
bun run check-deps  # 把守两条硬规则：无本地 @opentui 依赖、无裸 solid-js 导入
bun run probe       # 生成探针副本，插件「没反应」时用它定位
```

两套测试当前均 0 失败

---

## 六、注意事项 (开发用)

- 注册到 `tui.json` 的每一项都会被当成 npm 包名解析，写了不存在的包名会导致启动时安装失败
- 插件目录不要装 `node_modules`、不要放 `dist/`，`bun run check-deps` 会体检
- 插件加载失败不进日志也不进 stderr；排障与探针用法见 [docs/troubleshooting.md](docs/troubleshooting.md)

---

## 七、更多文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 版本历史：每个版本的显要变更，遵照 Keep a Changelog 格式 |
| [docs/install-and-loading.md](docs/install-and-loading.md) | 安装落点实测、JUNCTION 方案、入口为什么必须是原始 `.tsx` |
| [docs/metrics-and-render.md](docs/metrics-and-render.md) | 指标精确口径、单块渲染与三档刷新、自校准、设计决策记录 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 「完全没加载」复盘、两条硬规则、探针自诊断手法 |

---

## 八、致谢

本插件仿造以下两个参考项目重写，感谢两位作者的开源工作：

| 项目 | 作者 | 地址 |
|---|---|---|
| [opencode-tps1](https://github.com/fengye110/opencode-tps1) | fengye110 | https://github.com/fengye110/opencode-tps1 |
| [opencode-tps-meter](https://github.com/ChiR24/opencode-tps-meter) | ChiR24 | https://github.com/ChiR24/opencode-tps-meter |
