# my-opencode-tps-tui1

OpenCode 1.x TUI 的指标 HUD，渲染在会话提示行右侧

```
TPS 60.3 | AVG_TPS 104 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 9s | AVG_TTFT 10s | DUR 2m57s | TOTAL_DUR 26m45s | STS Waiting...
```

仿造 `opencode-tps1` 与 `opencode-tps-meter` 两个插件，取各自实现里更优的部分重写

---

## 一、两个参考插件的仓库定位

用 `opencode plugin <id>` 安装时，OpenCode 先按 npm 包名解析，因此「包名」才是权威线索

| 包名 | 版本 | 源码仓库 | 形态 |
|---|---|---|---|
| `opencode-tps1` | 0.1.2 | https://github.com/fengye110/opencode-tps1 | 单文件 `tui.tsx`，内联在 `session_prompt_right`，格式 `TPS x \| AVG x \| TTFT xs` |
| `opencode-tps-meter` | 0.3.1 | https://github.com/ChiR24/opencode-tps-meter | 多文件 TS，编译到 `dist/tui.mjs`，格式 `TPS: x (avg x) · n tok`，带 server 入口 |

两个包都声明了 `exports["./tui"]`，因此都走 TUI 插件通道

---

## 二、`opencode plugin` 的安装落点（OpenCode 1.18.27 实测）

在隔离 HOME 里实跑 `opencode plugin <pkg> --global`，日志给出 `Detected tui target` / `Detected server + tui targets`，落盘结果如下

| 项目 | 位置 |
|---|---|
| 包体 | `~/.cache/opencode/packages/<净化后的 spec>/node_modules/<包名>/` |
| 包体（spec 里的非法字符 `< > : " \| ? *` 与控制字符会替换成 `_`） | 同上 |
| 注册文件（TUI 通道） | 全局 `~/.config/opencode/tui.json`，项目级 `<project>/.opencode/tui.json` |
| 注册文件（server 通道） | 全局 `~/.config/opencode/opencode.json` / `opencode.jsonc`，项目级 `opencode.json` |
| 注册形式 | `plugin` 数组里追加一个纯字符串 spec，原样写回（无 options 时不用元组） |
| 入口识别 | `exports["./tui"]` → TUI target；`exports["./server"]` 或 `main` → server target；`package.json["oc-themes"]` → 主题 |

具体到这两个包

- `opencode-tps1` → `Detected tui target`，只写 `tui.json`，包体落在 `~/.cache/opencode/packages/opencode-tps1@latest/`
- `opencode-tps-meter` → `Detected server + tui targets`，同时写 `tui.json` 与 `opencode.jsonc`，包体落在 `~/.cache/opencode/packages/opencode-tps-meter@latest/`

结论：`opencode plugin opencode-tps1@latest --global` 会安装到 `~/.cache/opencode/packages/opencode-tps1@latest/node_modules/opencode-tps1/`，并把 `"opencode-tps1@latest"` 追加进 `~/.config/opencode/tui.json` 的 `plugin` 数组

### 一个必须知道的坑

OpenCode 1.18 内建的 Solid JSX 转换插件（`bun-plugin-solid`）过滤器带负向预查 `(?!.*[/\\]node_modules[/\\])`，也就是**不处理 `node_modules` 里的裸 `.tsx`**。于是

- 直接给 `tui.json` 一个**本地绝对路径**指向 `tui.tsx` → 不在 `node_modules` 里 → 走完整 Solid 转换 → 响应式正常
- 把裸 `.tsx` 作为 npm 包发布再由 `opencode plugin` 安装 → 落在 `node_modules` → 只由 Bun 原生 JSX 处理。若文件里没有 `/** @jsxImportSource @opentui/solid */` 指令，Bun 会默认按 React 处理，导入 `react/jsx-runtime` 直接失败

结论：**入口固定为原始 `tui.tsx`，只有这一条路**。文件头带 `/** @jsxImportSource @opentui/solid */` 指令，两种落点都成立 —— 路径含 `node_modules`（npm 安装形态）时跳过宿主转换器、由 Bun 原生 JSX 按指令编译；路径不含（本地路径 / junction）时走宿主的 Solid 转换器。预编译压缩产物反而会被宿主转换器处理并崩掉（实测，见第十二节）

---

## 三、安装与注册

### 采用方式：裸包名 + 缓存 junction

仓库本体留在自己的目录，`tui.jsonc` 里只写包名：

```jsonc
{
	"$schema": "https://opencode.ai/tui.json",
	"plugin": [
		"my-opencode-tps-tui1@latest"
	]
}
```

缓存侧用一条 junction 把入口指回本体，脚本放在仓库 `scripts\` 下：

```
scripts\relink.cmd
```

重启 TUI 生效，OpenCode 目前不热重载插件

### 备选：本地绝对路径

不想建 junction 时也可以直接指向源码入口，代价是无法按包名配置、换设备要改路径：

```jsonc
{
	"$schema": "https://opencode.ai/tui.json",
	"plugin": [
		["file:///<你的插件仓库路径>/tui.tsx", {}]
	]
}
```

注意 `tui.tsx` 在两种路径下都能正确编译（见第二节的结论）：`node_modules` 内靠文件头的 `@jsxImportSource` 指令，`node_modules` 外走宿主转换器。**不要**给它配预编译产物
---

## 四、配置项

插件选项走 `tui.json` 的 `[spec, options]` 元组

```jsonc
{
	"plugin": [
		[
			"file:///<你的插件仓库路径>/tui.tsx",
			{
				"items": ["TPS", "AVG_TPS", "TOKEN", "TOTAL_TK", "TTFT", "AVG_TTFT", "DUR", "TOTAL_DUR", "STS"],
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
| `separator` | `"\|"` | 字段间分隔符 |
| `countPrecision` | `4` | `TOKEN` / `TOTAL_TK` 缩写后最多保留的小数位 |
| `secondPrecision` | `0` | 纯秒档小数位；默认 `0` 即整秒展示（`5s`），想要 `8.5s` 写法设 `1` |
| `scope` | `"turn"` | 单次读数的口径，`turn` = 一轮对话聚合，`message` = 最近一条消息 |
| `liveEstimate` | `true` | 是否显示流式过程中的实时 TPS |
| `hideEmpty` | `false` | 无数据字段是否整段隐藏；默认不隐藏，用 `emptyText` 占位，整行宽度稳定 |
| `emptyText` | `"0"` | `hideEmpty=false` 时无数据字段显示的占位文本 |
| `colorize` | `true` | 会话忙时整行高亮为主题强调色，静止回落灰色（仿 `opencode-tps-meter`） |
| `refreshLiveMs` | `500` | 实时档采样间隔（`TPS` / `STS`） |
| `refreshCountMs` | `1000` | 计数档采样间隔（`TOKEN` / `TOTAL_TK` / `AVG_*`），嫌数字跳可调大 |
| `refreshClockMs` | `1000` | 时钟档采样间隔（`TTFT` / `DUR` / `TOTAL_DUR`），固定 1 秒让耗时逐秒可见 |
| `toastOnComplete` | `false` | 回答结束时额外弹一条 toast |
| `sts` | 见上 | STS 文案表，可逐项覆盖 |

---

## 五、指标口径

这一节是对原始需求里几个「待定」项的落地建议，全部集中在 `src/metrics.ts`，改动成本很低

### 术语

- **一轮对话（Turn）**：一条 user 消息 + 其后的全部 assistant 消息与工具步骤
- **生成时长（activeMs）**：每条消息「首个文本增量 → 结束」，**排除**工具执行与等待用户的停顿
- **本轮耗时（wall）**：请求发出 → 本轮最后一条消息完成，**包含**工具执行

### 各字段定义

| 字段 | 口径 |
|---|---|
| `TPS` | 最近 5 秒滚动窗口的实时速率，窗口内至少 1 秒才出读数。空闲后回落到本轮均值，不会显示占位符 |
| `AVG_TPS` | 会话累计输出词元 ÷ 会话累计**生成**时长（沿用 `opencode-tps1` 口径，排除工具停顿） |
| `TOKEN` | 本轮输出词元 = Σ（output + reasoning），流式中按在飞字节实时估算（单调不回落，完成后由权威值接管），`scope: "message"` 时改为最近一条消息 |
| `TOTAL_TK` | 会话累计输出词元，含进行中的本轮，随时间增长 |
| `TTFT` | 本轮**首条** assistant 消息的首字时延 = 首个文本增量 − 请求发出；首个增量到达即实时确定，不必等消息完成 |
| `AVG_TTFT` | 各轮 TTFT 的算术平均（分母是轮数，不是消息数） |
| `DUR` | 本轮耗时，wall 口径；会话忙时按当前时间逐秒增长，结算即冻结在结算值 |
| `TOTAL_DUR` | 各轮耗时之和，wall 口径；同样忙时逐秒增长、结算冻结 |
| `STS` | 见下 |

`AVG_TPS` 与 `TOTAL_DUR` 故意用不同口径：前者只算生成时间（所以能反映真实吐字速度），后者算端到端等待时间（所以能反映你等了多久）。示例里的 `AVG_TPS 104` 配 `TOTAL_DUR 26m45s` 只有在两套口径下才同时成立

### STS

数据源是 OpenCode 的 `session.status` 事件，取值只有 `idle` / `busy` / `retry` 三种，再叠加本地是否正在收流式增量

| 条件 | 默认文案 |
|---|---|
| 收到 `message.error` | `Error` |
| `retry` | `Retrying #{n}...`（`{n}` 换成重试次数） |
| `busy` 且正在吐字 | `Streaming...` |
| `busy` 且还没吐字 | `Waiting...` |
| `idle` | `Ready` |
| 尚未收到任何状态事件 | `-`（STS 永远有文案，不参与占位与隐藏） |

### 空闲不清零

- `session.idle` 只做两件事：把状态置为 `idle`、丢弃过期的实时窗口
- 累计值（`TOTAL_TK` / `TOTAL_DUR` / `AVG_*`）与上一轮的 `TOKEN` / `TTFT` / `DUR` 全部保留
- WARN user 消息的 `message.updated` 事件会重复投递、还会出现平台合成的全新 user 消息（换 ID），把清轮寄托在 user 事件上会导致流式中的 TOKEN 出现 350 -> 0 -> 100 -> 0 的锯齿（实测踩坑两次）
- 轮次裁决改为 assistant 消息驱动：仅当上一轮真正关闭（有完成时间且 finish ≠ tool-calls）时，下一条 assistant 消息才结算并开新轮；user 消息只做请求起点锚定与幂等去重，绝不直接清轮
- 单会话字段的重置只发生在「收到新的 user 消息」（新一轮开始）那一刻；`idle` / 完成 / 切走都不清，只有 `session.deleted`（真删会话）才释放
- `TPS` 在窗口过期后自动回落到本轮均值，于是挂机回来看到的是一行完整摘要，而不是一片占位符

### 实时速率与自校准

- 冷启动按 5 字节/词元估算
- 每条**无工具续跑**的消息完成后，用 `流式字节数 ÷ 真实词元数` 反向校准，并做 0.5 权重的指数平滑，比例夹在 2–8 之间
- 工具边界立即丢弃窗口，避免把工具执行时间算成低 TPS

---

## 六、单块渲染与三档刷新

整行只有**一个** `<text>` 节点：全部字段拼进同一个字符串，间距由文本自身的空格决定，不再受 flex `gap` 影响，拖拽选中时也是完整一块

刷新做成一个基准节拍（250ms）+ 三档到期判定：

| 档位 | 字段 | 默认间隔 |
|---|---|---|
| live | `TPS` / `STS` | 500ms |
| count | `TOKEN` / `TOTAL_TK` / `AVG_*` | 1000ms |
| clock | `TTFT` / `DUR` / `TOTAL_DUR` | 1000ms |

- 字段只在所属档位到期时重新取值，未到期沿用旧值，所以计数类数字不会被高频事件带着抖动
- 事件分两类：状态类（消息完成 / 会话状态变化）强制全量刷新；流式增量走节流档
- 内容真变化才 `requestRender`，全部档位未到期的节拍是纯空转，没有渲染开销

---

## 七、自检

```bash
bun run selftest   # 纯逻辑：格式化分档 + 事件流模拟 + 配置归一化
bun run loadtest   # 加载级：现编 tui.tsx 产物 + 桩件实跑事件流
```

`selftest` 覆盖计数缩写分档、时长的 ms/s/m+s/h+m+s 四档、速率分档、字段顺序、空值隐藏、配置归一化，并用合成事件流跑出一条完整状态行

`loadtest` 在 `.loadtest/` 下生成桩件替掉 `@opentui/solid` 与 `solid-js`，现编一份 `tui.tsx` 产物真实 import 进来，校验单块 text 节点的 content / fg、事件接线、空值占位、活动高亮、耗时冻结、幂等、重试 / 错误文案与会话释放。自含构建步骤，无需预构建

两套脚本当前均 0 失败；另有一条 bun run check-deps，把守两条硬规则：插件目录不得存在本地 @opentui 依赖、产物不得含裸 solid-js 导入

---

## 八、注意事项

注册到 `~/.config/opencode/tui.json` 的每一项都会被 OpenCode 当成 npm 包名去解析。当前本机配置里有 `"opencode-my-tps@latest"`，而该包在 npm 上返回 404，启动时会尝试安装并失败。要么删掉这一项，要么把包名换成真实存在的包

---

## 九、决策记录与仍开放项

已定案（按使用反馈）：

1. **纯秒档小数位**：默认 `secondPrecision: 0`，整秒展示（`5s`）；亚秒保留 ms 档。要 `8.5s` 写法设 `1`
2. **`items` 默认值**：去重后的 9 项（`AVG_TTFT` 重复项已合并）
3. **STS 文案**：`Waiting...` / `Streaming...` / `Ready` 已实测采用，可经 `options.sts` 逐项覆盖
4. **耗时字段名**：`CST` / `TOTAL_CST` 更名为 `DUR` / `TOTAL_DUR`

仍开放：

- **跨重启持久化**：累计值只活在进程内，OpenCode 重启后从零开始。TUI API 提供 `api.kv`，是否做持久化待定

---
## 十、安装落点与 junction 方案（实测）

### 为什么 `tui.jsonc` 里可以直接写包名

裸 spec 的解析路径：

1. spec 拆成 `<name>@<version>`。没有 `@` 时 version 取 `latest`，`@scope/pkg` 因 `lastIndexOf("@") === 0` 也走无版本分支
2. 目录锁定为 `~/.cache/opencode/packages/<净化 spec>/`，其中 `< > : " | ? *` 与控制字符替换成 `_`
3. 短路条件：`<该目录>/node_modules/<name>` 已存在，则直接 `import.meta.resolve` 解析，不跑 npm install
4. 否则 `npm reify` 去 registry 装

所以只要把包按 npm 形态摆进缓存目录，就能用裸 ID 配置，全程不碰网络

### 目录形态（不是把整个 spec 目录做成 junction）

```
仓库本体                                     <插件仓库目录>\my-opencode-tps-tui1

%USERPROFILE%\.cache\opencode\packages\my-opencode-tps-tui1@latest\
├── package.json                             {"dependencies":{"my-opencode-tps-tui1":"latest"}}
└── node_modules\
    └── my-opencode-tps-tui1   →  junction  →  仓库本体
```

把整个 `<spec>` 目录做成 junction 不行，因为短路判断查的正是 `<spec>/node_modules/<name>`，整目录 junction 之后该路径依然不存在，会掉进 npm install

### 为什么仓库本体不放进 `.config/opencode`

- 本插件独立成库推 GitHub。Git 不会收编嵌套仓库，父仓库只会把它记成 embedded repo 的 gitlink，两边的版本管理反而互相碍事
- 本体留在自己的仓库目录即可，缓存侧只放一条 junction，而 junction 可以随时重建
- 唯一代价：`%USERPROFILE%\.cache\opencode` 被清掉后链接会消失、插件静默失效，重跑 `scripts\relink.cmd` 就能恢复

### 各位置的存活能力对比

| 位置 | git 跟踪 | `opencode uninstall` | 结论 |
|---|---|---|---|
| 独立仓库目录 + 缓存 junction | 是，自己的仓库 | 只丢 junction，重跑脚本即恢复 | 采用 |
| `~/.config/opencode/plugins/<名>/` | 父仓库不会收编嵌套仓库 | `--keep-config` 可保 | 两处版本管理打架 |
| `~/.cache/opencode/packages/...` | 否 | Cache 在移除清单里硬编码 keep=false，无 keep 开关 | 会被直接删掉，禁用 |

`opencode uninstall` 的移除清单是 Data(keep=--keep-data) / Cache(keep=false) / Config(keep=--keep-config) / State(keep=false)。Cache 没有 keep 开关，所以本体绝不能放那儿

### 重建命令

```
scripts\relink.cmd
```

脚本放在仓库 `scripts\` 下，向上取一级作为本体目录，自动完成：写外壳 `package.json` → 建 junction → 穿透校验。已就绪时直接返回、不做任何删除；仅在链接损坏时才用不带 `/S` 的 `RMDIR` 移除旧链接，失败即中止

不用脚本的等价手工命令：

```
mklink /J "%USERPROFILE%\.cache\opencode\packages\my-opencode-tps-tui1@latest\node_modules\my-opencode-tps-tui1" "<仓库本体>"
```

### 几个实测注意点

- `opencode plugin` 插入新条目时会把插入点之后的缩进重排成空格，结构依旧合法，只是序列化器不保留原缩进；已存在的条目走 `Already configured` 分支，不重写文件
- 入口是原始 `tui.tsx`，**不需要任何构建产物**，跨设备克隆后直接可加载；插件目录也不需要 `node_modules`（`bun run check-deps` 会把 `dist/` 和本地 `@opentui` 都判为违规）
- `.config/opencode/plugins/` 的自动扫描 glob 是 `{plugin,plugins}/*.{ts,js}`，只匹配直属文件、不递归子目录

---

## 十一、为什么一开始「完全没加载」（复盘）

现象：`tui.jsonc` 里配了裸包名，但 `plugin-meta.json` 没有条目，`opencode.log` 零记录，stderr 也是空的

### 两个真实原因

用「把 `dist/tui.js` 直接登记成插件入口，让它在 `app_bottom` 槽位渲染诊断文本」的探针法逐层剥离，得到两个原因

1. **本地装了 `@opentui/solid`**
   `bun install` 在插件目录生成的 `node_modules/@opentui/solid` 会拉起第二份 `@opentui/core`，与宿主抢注册同一个环境变量，直接抛错

   ```
   Environment variable "OPENTUI_FORCE_WCWIDTH" is already registered with different configuration
   ```

   于是整个插件被静默丢弃

2. **裸 specifier 不会被宿主重写**
   清掉本地依赖后暴露第二层：`import { createSignal } from "solid-js"` 解析失败，报文是 `Cannot find package 'solid-js'`
   OpenCode 的运行时重写只覆盖 `@opentui/solid` 这类**子路径** specifier，裸 specifier 照常走普通解析（对应实现里的 `nodeModulesBareSpecifiers` 默认为 false）
   参考插件 `opencode-tps1` 正因为这个裸导入而加载不了；`oh-my-opencode-slim` 是整包打包、没有任何外部 import，所以它没事

### 两条硬规则

- 插件入口**不得出现来自 `solid-js` 的裸导入**。刷新一律走命令式：`ref` 拿到节点后改 `content`，再 `requestRender`。本插件已按此实现
- 插件目录**不得存在 `node_modules/@opentui`**。`bun run check-deps` 会同时检查这两项

### 排查手法留档

- TUI 插件的加载异常走 `console.error("[tui.plugin] ...")`，**不写进 `opencode.log`**，也不出现在 stderr（`--print-logs`、`--log-level DEBUG` 都拿不到）→ 只能靠探针插件
- `plugin-meta.json` 只对部分插件写条目（`oh-my-opencode-slim` 有、纯 TUI 插件没有），**不能当作是否加载的判据**
- 启动画面在管道 stdin 下永远停在 `Finishing startup…`，进不了会话视图；要观测渲染结果，探针必须注册在 `app_bottom` 这类首页可见的槽位
- `tui.jsonc` 里写进去的包名**不会触发自动安装**。`opencode-tps1@latest` / `opencode-tps-meter@latest` 在缓存里根本不存在，所以它们也一直没加载；缺失的包会被静默跳过
---

## 十二、入口为什么必须用原始 `.tsx`，以及一次自诊断

### 换掉预编译产物的理由

对照两个能正常工作的参考插件

| 插件 | 入口 | 落点 |
|---|---|---|
| `opencode-tps1` | 原始 `tui.tsx` | `node_modules` 内 |
| `opencode-tps-meter` | 预编译 `dist/tui.mjs` | `node_modules` 内 |

两者都满足同一个前提：**入口文件位于路径含 `node_modules` 的位置**。宿主的 Solid 转换插件过滤器是

```
/^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/
```

也就是**跳过 `node_modules` 下的文件**。而本插件按 junction 方案加载时，`import.meta.resolve` 会把 junction 展开成真实路径 `<仓库本体>/...`，**路径里没有 `node_modules`**，于是转换器会去处理这个文件

- 原始 `.tsx` → 转换器正常工作，产出正确的元素树（已实测渲染出完整一行）
- 预编译 + 压缩过的 `.js` → 转换器处理它时会出问题，导致整个入口模块加载失败，插件被静默丢弃

所以：**入口固定为原始 `tui.tsx`**。它在两种落点下都对

- 路径含 `node_modules`（真实安装）→ 跳过转换器 → 靠文件头的 `/** @jsxImportSource @opentui/solid */` 指令
- 路径不含 `node_modules`（junction）→ 走转换器

`bun run check-deps` 会把守这条：入口不是 `.tsx`、或存在 `dist/` 目录，都会报错

### 一次自诊断（把"没反应"变成"看得见"）

TUI 插件的加载失败不留任何痕迹，所以出问题时要主动把槽位挪到首页可见的位置

1. 生成一份探针副本（槽位从 `session_prompt_right` 换成 `app_bottom`）

   ```
   bun run scripts/probe.ts
   ```

2. 它会打印一个临时目录路径，并提示在里面执行 `opencode`

3. 探针会把状态行渲染在首页底部。看到 `TPS - | AVG_TPS - | ...` 就说明插件本体与注册链路都正常；什么都看不到就是加载失败

4. 探针是临时副本，不影响仓库里的正式文件

---

## 十三、v0.2 交互打磨（按真人使用反馈）

- **单块渲染**：整行合并为一个 `<text>`，修掉多节点 flex `gap` 造成的段间间距不均
- **空值占位**：`hideEmpty` 默认 `false`，无数据字段显示 `emptyText`（默认 `0`），结构稳定
- **活动高亮**：`colorize` 默认 `true`，会话忙整行白色高亮，静止回落灰色
- **耗时逐秒刷新**：`DUR` / `TOTAL_DUR` 忙时逐秒增长、结算冻结（对齐 OpenChamber 等 Harness 的做法）
- **计数采样**：`refreshCountMs` 默认 1000ms（先调到 2000 后按使用反馈改回，与节流前的事件直刷相比仍被压住了频率）
- **字段更名**：`CST` / `TOTAL_CST` → `DUR` / `TOTAL_DUR`（原名易误读为金钱开销）
- **轮次裁决重构**：清轮只由「上一轮关闭（finish ≠ tool-calls）+ 新 assistant 消息」触发，杜绝对话中/结束后被锯齿清零
- **TTFT 实时化**：首个流式增量到达即确定，流式期间也可读
- **时间整秒**：`secondPrecision` 默认 0，`5.46s` → `5s`
