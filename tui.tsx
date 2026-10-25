/** @jsxImportSource @opentui/solid */
/**
 * my-opencode-tps-tui1 — OpenCode 1.x TUI 插件
 * </br>在 session_prompt_right 槽位渲染一行指标，并在侧边栏渲染可折叠指标区块：
 * <pre><code>
 *     TPS 60.3 | AVG_TPS 104 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 8.50s |
 *     AVG_TTFT 9.50s | DUR 2m57s | TOTAL_DUR 26m45s | STS Waiting...
 * </code></pre>
 * </br>设计要点：
 * <ul>
 *     <li>指标全部来自 OpenCode 公开事件流，只有实时窗口用字节估算并自校准</li>
 *     <li>prompt 行保持单块 <code><text></code>：字段拼进同一个字符串，间距由文本自身空格决定</li>
 *     <li>侧边栏区块每字段独立成一行：左标签 + 右值两个 <code><text></code> cell，
 *     由 <code>justifyContent="space-between"</code> 把值顶到容器右边界；不补空格、无边框、无行分隔线</li>
 *     <li>侧边栏区块里标签与数值统一 <code>theme.textMuted</code>，只有标题行用 <code>theme.text</code>；
 *     <code>colorize</code> 只影响 prompt 单行，不影响侧边栏</li>
 *     <li>工作状态由标题行右侧的 braille 缓冲动画图标表达：活动时显示并加载动画、闲置时隐藏，
 *     节点宽度固定 2 列以吸收 braille 的 East Asian Ambiguous 宽度不确定性</li>
 *     <li>刷新走命令式：ref 拿到节点后直接改 content / fg / visible 再 requestRender</li>
 *     <li>三档刷新 (live / count / clock) 共用基准节拍，字段各自到期才取值，空转节拍不产生渲染开销</li>
 *     <li>动画图标另有独立的 100ms 帧节拍，与 250ms 指标节拍互不干扰；没有活动实例时整拍跳过</li>
 *     <li>折叠态持久化到 api.kv，命令面板提供切换命令并带默认键位</li>
 * </ul>
 * </br>WARN 本插件全程采用命令式渲染，不使用 Solid 响应式原语
 * （createSignal / createMemo / Show / For 一律不写）：
 * <ul>
 *     <li><b>真正致命的是插件目录装出 <code>node_modules</code></b>。宿主的 Solid 转换插件
 *     用负向先行断言排除路径含 <code>node_modules</code> 的文件，那些文件不会被转换；
 *     同时第二份 <code>@opentui/core</code> 会与宿主抢注环境变量 <code>OPENTUI_FORCE_WCWIDTH</code>
 *     直接抛错，插件被静默丢弃（不进日志、不进 stderr）</li>
 *     <li>本仓库的 <code>scripts/check-deps.ts</code> 会拦截 node_modules/@opentui 与
 *     node_modules/solid-js，务必让 <code>bun run check-deps</code> 保持通过</li>
 * </ul>
 * </br>NOTE 关于 "solid-js" 裸导入的一条更正（2026-10-15 核实，勿再照旧结论）：
 * <ul>
 *     <li>宿主 <code>@opentui/solid/runtime-plugin-support/configure.js</code> 的重写映射表里
 *     <b>确实包含 <code>"solid-js"</code> 与 <code>"solid-js/store"</code></b>，裸 specifier
 *     会被改写到宿主那唯一一份实例，<b>不是</b>「照常解析并失败」。OpenCode 内置的
 *     MCP / LSP / Todo / Files 四个侧边栏区块自己就写
 *     <code>import { createSignal, Show } from "solid-js"</code></li>
 *     <li>所以本文件头原先那句「绝不能出现裸导入」的表述是错的，已更正。
 *     <code>check-deps.ts</code> 规则二的正则拦截<b>刻意保留</b>，只是把注释改成准确描述 ——
 *     去留拦截需要真机验证，不该只凭源码推断就动安全闸门</li>
 * </ul>
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { FIELD_TIER, resolveConfig, type FieldName, type ResolvedConfig } from "./src/config.js"
import { EMPTY } from "./src/format.js"
import {
	buildReadout,
	forgetSession,
	freshState,
	noteAssistantFinished,
	noteAssistantStarted,
	noteError,
	noteIdle,
	noteStatus,
	noteTextDelta,
	noteToolBoundary,
	noteUserMessage,
	type MetricsState,
	type Readout,
} from "./src/metrics.js"
import { composeLine, displayValue, displayWidth, fieldValue } from "./src/render.js"

// ===== ===== ===== ===== [常量与类型] ===== ===== ===== =====

/** CONST 基准调度粒度：所有刷新档位都在这个节拍上对齐 */
const TICK_MS = 250

/** CONST 缓冲动画图标的帧间隔，独立于 TICK_MS：250ms 的指标节拍会让 10 帧动画跳格 */
const SPINNER_FRAME_MS = 100

/** CONST 缓冲动画图标的帧表，参考 OMO-SLIM Agents 区块的 braille spinner */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** VAR 模块级帧计数器：每次跳帧前进一格，对 SPINNER_FRAMES 取模 */
let spinnerFrame = 0

/** VAR 侧边栏区块的标题行分区登记，与左侧 (箭头 / 标题 / 摘要) 区分开 */
type SidebarTitle = {
	/** VAR 右侧缓冲动画图标节点 */
	spinnerNode: TextNode | undefined
	/** VAR 该实例当前是否处于活动态，决定动画图标显隐 */
	active: boolean
	/** VAR 存活探针：组件自报，供帧定时器回收已卸载实例 */
	alive: (() => boolean) | undefined
}

/** VAR 单个已登记的刷新回调，附带存活探针以便回收已卸载组件 */
type Painter = {
	/** VAR 组件自报的渲染入口 */
	request: (now: number, force: boolean) => void
	/** VAR 存活探针：组件自报，缺省时按存活处理 */
	alive: (() => boolean) | undefined
}

/** VAR 当前已挂载的侧边栏标题行，按 sessionID 索引，供定时器逐帧写入 */
const sidebarTitles = new Map<string, SidebarTitle>()

/** CONST 侧边栏折叠态在 api.kv 中的键，必须带前缀避免与全局共享空间里的其他插件撞车 */
const KV_KEY = "my-opencode-tps-tui1:sidebar:collapsed"

/** VAR 可被命令式改写的文本节点最小形态 */
type TextNode = {
	content: string
	fg?: unknown
	visible?: boolean
	/** VAR opentui 的销毁标志；属性可选，未置位时按存活处理 (见 isAlive) */
	isDestroyed?: boolean
}

/** VAR 可被命令式改写的 box 节点最小形态 */
type BoxNode = {
	visible?: boolean
	/** VAR opentui 的销毁标志；属性可选，未置位时按存活处理 (见 isAlive) */
	isDestroyed?: boolean
}

/** VAR 主题色令牌：宿主主题返回 RGBA 对象，fg 属性同样接受它 */
type ColorToken = string | object

/** VAR 单字段的采样缓存：所属档位到期才重新取值，未到期沿用旧值 */
type FieldSlot = {
	field: FieldName
	value: string
	at: number
}

/** VAR 侧边栏字段行里已被 ref 捕获的节点 */
type FieldRow = {
	boxNode: BoxNode | undefined
	labelNode: TextNode | undefined
	valueNode: TextNode | undefined
}

/** VAR 侧边栏控制器：命令的 run() 通过它把新状态穿透到已挂载的组件实例 */
type SidebarController = {
	sessionID: string
	setCollapsed(value: boolean): void
}

/** VAR 模块级折叠真值：命令与所有组件实例共享同一来源；每次插件加载时会在入口重置 */
let sidebarCollapsedGlobal: boolean | undefined = undefined

/** VAR 当前已挂载的侧边栏实例控制器，按 sessionID 索引 */
const sidebarControllers = new Map<string, SidebarController>()

// ===== ===== ===== ===== [内部方法] ===== ===== ===== =====

/**
 * 判定一个已捕获的节点是否仍然存活
 * </br>opentui 在槽位节点被替换或树被拆除时走 <code>destroyRecursively()</code>，把节点
 * 的 <code>isDestroyed</code> 置为 true。该属性在类型上是可选的：若某些卸载路径并不置位，
 * 这里只是拿不到额外的回收能力，不会因此出错。
 * @param {{ isDestroyed?: boolean } | undefined} node 已通过 ref 捕获的节点，未捕获时传 undefined
 * @return {boolean} alive true 表示节点仍可安全写入
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note 判据严格取 <code>=== true</code>：属性缺失 (undefined) 一律视为存活，绝不误删活着的组件
 */
function isAlive(node: { isDestroyed?: boolean } | undefined): boolean {
	// BRANCH 节点尚未捕获时无从判断，按存活处理，交给后续 ref 补齐
	if (node === undefined) return true;
	
	// BRANCH 只有显式 true 才判定为已销毁，其余取值 (含 undefined / false) 均视为存活
	return node.isDestroyed !== true;
	
}

/**
 * 求值一个可选的存活探针
 * </br>探针缺省时一律按存活处理：opentui 在部分卸载路径下并不置 isDestroyed，
 * 这种情况下我们只是拿不到额外的回收能力，绝不能因此把活着的组件误删。
 * @param {(() => boolean) | undefined} probe 组件自报的存活探针
 * @return {boolean} alive true 表示应当保留该条目
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note 探针自身抛错时同样按存活降级，宁可漏回收也不误删
 */
function isAliveProbe(probe: (() => boolean) | undefined): boolean {
	// BRANCH 没有探针：无从判断，按存活处理
	if (probe === undefined) return true;
	
	// BRANCH 探针报错：按存活降级，宁可漏回收也不误删活着的组件
	try {
		return probe();
	} catch {
		return true;
	}
	
}

// ===== ===== ===== ===== [组件] ===== ===== ===== =====

/**
 * 决定 prompt 单行颜色
 * </br>colorize 开启时：会话忙 (有活动) 整行高亮为主题强调色，静止回落弱化色；
 * 关闭时恒为弱化色。
 * </br>注意：本函数只供 StatusRow 使用。侧边栏区块遵循 Agents 设计，字段标签与数值一律
 * <code>theme.textMuted</code>，不受 colorize 影响；只有标题行用 <code>theme.text</code>。
 * @param {Readout | undefined} readout 读数，尚未产生时视为静止
 * @param {ResolvedConfig} config 配置
 * @param {TuiPluginApi} api 插件 API
 * @return {ColorToken} color 颜色令牌
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function colorFor(readout: Readout | undefined, config: ResolvedConfig, api: TuiPluginApi): ColorToken {
	// STEP 取当前主题
	const theme = api.theme.current
	
	// BRANCH 关闭着色时恒为弱化色
	if (! config.colorize) return theme.textMuted
	
	// BRANCH 有活动 (busy) 整行高亮，静止回落灰色
	return readout !== undefined && readout.active ? theme.text : theme.textMuted;
	
}

/**
 * 状态行组件：渲染单块 <code><text></code>，并把逐档刷新的 request 回调登记给宿主
 * </br>内部维护每字段的采样缓存，只在字段所属档位到期时重新取值；
 * 内容真变化才改写节点并 requestRender。
 * </br>本组件受 <code>colorize</code> 开关控制，活动时变白、静止时变灰。
 * @param {object} props 插件传入的属性集合，包含以下字段：
 *         <ul>
 *             <li>api：插件 API</li>
 *             <li>sessionID：当前会话 ID</li>
 *             <li>state：全局指标状态</li>
 *             <li>config：解析后的配置</li>
 *             <li>register：登记刷新回调的函数</li>
 *         </ul>
 * @return {object} node 单块 box > text 节点
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function StatusRow(props: {
	api: TuiPluginApi
	sessionID: string
	state: MetricsState
	config: ResolvedConfig
	register: (sessionID: string, request: (now: number, force: boolean) => void, alive?: () => boolean) => void
}) {
	// VAR 每字段的采样缓存，at=0 表示从未采样
	const slots: FieldSlot[] = props.config.items.map((field) => ({ field, value: "", at: 0 }))
	let node: TextNode | undefined
	let lastLine: string | undefined
	let lastColor: ColorToken | undefined
	
	// SUBSTEP 取字段所属档位的刷新间隔
	const intervalOf = (field: FieldName) => props.config.refresh[FIELD_TIER[field]]
	
	// SUBSTEP 判定是否存在任一到期字段，全部未到期时节拍可跳过
	const due = (now: number) => {
		// STEP 逐字段检查是否到期
		for (const slot of slots) {
			if ((now - slot.at) >= intervalOf(slot.field)) return true
		}
		return false
		
	}
	
	// SUBSTEP 执行一次采样渲染：按档位取值 → 差异写节点 → 按需请求重绘
	const render = (now: number, force: boolean) => {
		// STEP 取最新读数
		const readout = buildReadout(props.state, props.sessionID, now, props.config)
		
		// STEP 逐字段采样：只在所属档位到期 (或强制) 时重新取值，未到期沿用旧值，
		// 计数类字段因此不会被高频事件带着抖动
		for (const slot of slots) {
			if (! force && (now - slot.at) < intervalOf(slot.field)) continue
			slot.value = fieldValue(slot.field, readout, props.config)
			slot.at = now
		}
		
		// BRANCH 节点未捕获 (ref 未回调) 时无处可写，直接返回
		if (node === undefined) return
		
		// SUBSTEP 拼整行，内容变化才写节点
		let dirty = false
		const line = composeLine(slots, props.config)
		if (line !== lastLine) {
			lastLine = line
			node.content = line
			dirty = true
		}
		
		// SUBSTEP 颜色变化才写节点
		const color = colorFor(readout, props.config, props.api)
		if (color !== lastColor) {
			lastColor = color
			node.fg = color
			dirty = true
		}
		
		// STEP 内容真的变化才请求重绘，空转节拍不产生任何渲染开销
		if (dirty) props.api.renderer.requestRender()
		
	}
	
	// SUBSTEP 对外暴露的刷新入口：未到期且非强制时直接跳过
	const request = (now: number, force: boolean) => {
		if (! force && ! due(now)) return
		render(now, force)
		
	}
	
	// STEP 把刷新回调登记给宿主 (以 sessionID 为键，避免重复注册堆积)，
	// 并自报存活探针：节点被宿主销毁后据此从 painters 里回收
	props.register(props.sessionID, request, () => isAlive(node))
	
	// STEP 渲染单块结构：box > text，ref 回调里捕获节点并做首帧强制采样
	return (
		<box flexDirection="row" flexShrink={0}>
			<text
				fg={props.api.theme.current.textMuted}
				ref={(ref: TextNode) => {
					node = ref
					// STEP 首帧全字段强制采样
					render(Date.now(), true)
				}}
			>
				{""}
			</text>
		</box>
	)
	
}

/**
 * 侧边栏指标区块组件：可点击折叠的标题行 + 每字段一行的左标签 / 右值 row。
 * </br>排版完全仿造 Agents：
 * <ul>
 *     <li>每字段一个 <code>width="100%"</code> 的 row box，用 <code>justifyContent="space-between"</code>
 *     把值顶到容器右边界</li>
 *     <li><code>sidebarAlign=false</code> 时去掉 <code>space-between</code>，改用 <code>columnGap={1}</code>
 *     让标签与值自然紧邻</li>
 *     <li>零边框、零行间 gap、零补空格对齐</li>
 *     <li>标签与数值统一 <code>theme.textMuted</code>；标题、箭头用 <code>theme.text</code></li>
 *     <li><code>colorize</code> 对侧边栏区块不生效，只影响 prompt 行的 StatusRow</li>
 * </ul>
 * </br>折叠时只保留标题行，字段行通过 row box 的 <code>visible=false</code> 隐藏而不是增删节点。
 * @param {object} props 插件传入的属性集合，包含以下字段：
 *         <ul>
 *             <li>api：插件 API</li>
 *             <li>sessionID：当前会话 ID</li>
 *             <li>state：全局指标状态</li>
 *             <li>config：解析后的配置</li>
 *             <li>register：登记刷新回调的函数</li>
 *         </ul>
 * @return {object} node box > (title box + field row box...) 节点树
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function SidebarSection(props: {
	api: TuiPluginApi
	sessionID: string
	state: MetricsState
	config: ResolvedConfig
	register: (sessionID: string, request: (now: number, force: boolean) => void, alive?: () => boolean) => void
}) {
	// VAR 每字段的采样缓存与已捕获的 row 节点
	const slots: FieldSlot[] = props.config.items.map((field) => ({ field, value: "", at: 0 }))
	const fieldRows: FieldRow[] = props.config.items.map(() => ({ boxNode: undefined, labelNode: undefined, valueNode: undefined }))
	let arrowNode: TextNode | undefined
	let titleNode: TextNode | undefined
	let summaryNode: TextNode | undefined
	let spinnerNode: TextNode | undefined
	let spinnerActive = false
	let firstRenderDone = false
	let lastSummary = ""
	
	// SUBSTEP 取字段所属档位的刷新间隔
	const intervalOf = (field: FieldName) => props.config.refresh[FIELD_TIER[field]]
	
	// SUBSTEP 判定是否存在任一到期字段
	const due = (now: number) => {
		// STEP 逐字段检查是否到期
		for (const slot of slots) {
			if ((now - slot.at) >= intervalOf(slot.field)) return true
		}
		return false
		
	}
	
	// SUBSTEP 初始化折叠态：优先取已持久化的 kv 值，它代表用户上次留下的状态；
	// kv 未命中时才用 config.sidebarCollapsed 这个显式配置兜底
	if (sidebarCollapsedGlobal === undefined) {
		sidebarCollapsedGlobal = props.api.kv.get<boolean>(KV_KEY, props.config.sidebarCollapsed)
	}
	let collapsed = sidebarCollapsedGlobal
	
	// SUBSTEP 改写全部受折叠影响的节点并持久化新状态
	const setCollapsed = (value: boolean) => {
		// STEP 同步模块级真值与本实例局部变量
		collapsed = value
		sidebarCollapsedGlobal = value
		
		// STEP 持久化到全局 kv
		props.api.kv.set(KV_KEY, value)
		
		// SUBSTEP 改写箭头 glyph
		if (arrowNode !== undefined) arrowNode.content = value ? "▶" : "▼"
		
		// SUBSTEP 折叠时显示摘要，展开时清空
		if (summaryNode !== undefined) summaryNode.content = value ? lastSummary : ""
		
		// SUBSTEP 字段行整体显隐：直接改 row box 的 visible，不动子节点
		for (const row of fieldRows) {
			if (row.boxNode !== undefined) row.boxNode.visible = value ? false : true
		}
		
		// STEP 请求重绘
		props.api.renderer.requestRender()
		
	}
	
	// SUBSTEP 切换折叠态的便捷入口
	const toggle = () => setCollapsed(! collapsed)
	
	// STEP 把本实例注册到模块级控制器表，让 keymap 命令能穿透到所有实例
	const controller: SidebarController = {
		sessionID: props.sessionID,
		setCollapsed,
	}
	sidebarControllers.set(props.sessionID, controller)
	
	// STEP 把标题行登记到模块级动画表：帧定时器据此逐帧写右侧缓冲动画图标
	// 存活探针挂在标题节点上：侧边栏被折叠收起或切走时整块树会被 destroyRecursively，
	// 据此回收本实例的动画与渲染登记，避免帧定时器往死节点写内容
	// BRANCH sidebarSpinner=false 时不登记：连同节点与帧定时器一并省掉
	const spinnerEnabled = props.config.sidebarSpinner
	const spinner: SidebarTitle = {
		spinnerNode: undefined,
		active: false,
		alive: () => isAlive(titleNode),
	}
	if (spinnerEnabled) sidebarTitles.set(props.sessionID, spinner)
	
	// SUBSTEP 改写缓冲动画图标的显隐与首帧内容：活动显示、闲置隐藏
	const applySpinner = (active: boolean) => {
		// BRANCH 开关关闭：节点根本没建，直接空转返回
		if (! spinnerEnabled) return
		
		// STEP 同步真值，供帧定时器做空闲门控
		spinnerActive = active
		spinner.active = active
		
		// BRANCH 节点尚未捕获 (ref 未回调) 时无处可写
		if (spinnerNode === undefined) return
		
		// STEP 显隐与活动态对齐：闲置时隐藏整个节点，不留空格占位
		if (spinnerNode.visible !== active) spinnerNode.visible = active
		
		// BRANCH 闲置即停止写内容，帧推进交给帧定时器
		if (! active) return
		
		// STEP 刚进入活动态时补上首帧内容，避免图标空着等待下一次跳帧
		if (spinnerNode.content === "") spinnerNode.content = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
		
	}
	
	// SUBSTEP 尝试首帧渲染：所有 ref 都回调后才强制采样一次
	const tryFirstRender = () => {
		// BRANCH 已经渲染过，或关键节点尚未捕获，直接返回
		if (firstRenderDone) return
		if (arrowNode === undefined || titleNode === undefined || summaryNode === undefined) return
		if (fieldRows.length < props.config.items.length) return
		for (const row of fieldRows) {
			if (row.boxNode === undefined || row.labelNode === undefined || row.valueNode === undefined) return
		}
		
		// STEP 节点全部就位，强制全量采样
		firstRenderDone = true
		render(Date.now(), true)
		
	}
	
	// SUBSTEP 执行一次侧边栏采样渲染
	const render = (now: number, force: boolean) => {
		// STEP 取最新读数
		const readout = buildReadout(props.state, props.sessionID, now, props.config)
		
		// STEP 逐字段采样
		for (const slot of slots) {
			if (! force && (now - slot.at) < intervalOf(slot.field)) continue
			slot.value = fieldValue(slot.field, readout, props.config)
			slot.at = now
		}
		
		// STEP 侧边栏统一用弱化色；colorize 只影响 prompt 行的 StatusRow，不影响这里
		const muted = props.api.theme.current.textMuted
		
		// STEP 逐字段渲染：label / value 分离，靠 flex space-between 做列对齐
		for (let index = 0; index < fieldRows.length; index = index + 1) {
			const row = fieldRows[index]
			if (row.boxNode === undefined) continue
			
			const slot = slots[index]
			const field = slot.field
			const label = props.config.labels[field]
			const value = displayValue(field, slot.value, props.config)
			
			// SUBSTEP 改写 label cell
			if (row.labelNode !== undefined) {
				if (row.labelNode.content !== label) row.labelNode.content = label
				if (row.labelNode.fg !== muted) row.labelNode.fg = muted
			}
			
			// SUBSTEP 改写 value cell；STS 等长文案由 truncate 处理，不因此挤压数值行的右边界，
			// 因为每一行都是独立的 100% 宽容器，右边界是侧边栏内边距决定的容器边缘，
			// 而不是按内容最大宽度计算出来的对齐列宽
			if (row.valueNode !== undefined) {
				if (row.valueNode.content !== value) row.valueNode.content = value
				if (row.valueNode.fg !== muted) row.valueNode.fg = muted
			}
			
			// SUBSTEP 可见性：折叠隐藏；展开时按 hideEmpty 过滤无数据字段 (STS 永远显示)
			const isMissing = field !== "STS" && slot.value === EMPTY
			const shouldShow = (! collapsed) && (! props.config.hideEmpty || ! isMissing)
			if (row.boxNode.visible !== shouldShow) row.boxNode.visible = shouldShow
		}
		
		// SUBSTEP 生成折叠态摘要：优先显示累计词元，没有时回落到状态文案
		const totalTkSlot = slots.find((slot) => slot.field === "TOTAL_TK")
		const totalTkValue = totalTkSlot === undefined
			? ""
			: displayValue("TOTAL_TK", totalTkSlot.value, props.config)
		if (totalTkValue !== props.config.emptyText) {
			lastSummary = totalTkValue === "" ? "" : ` ${totalTkValue}`
		} else {
			const stsSlot = slots.find((slot) => slot.field === "STS")
			const stsValue = stsSlot === undefined ? "" : displayValue("STS", stsSlot.value, props.config)
			lastSummary = (stsValue === "" || stsValue === props.config.sts.unknown) ? "" : ` ${stsValue}`
		}
		
		// SUBSTEP 摘要节点只在折叠态显示
		if (summaryNode !== undefined) {
			const nextSummary = collapsed ? lastSummary : ""
			if (summaryNode.content !== nextSummary) summaryNode.content = nextSummary
			if (summaryNode.fg !== muted) summaryNode.fg = muted
		}
		
		// SUBSTEP 标题与箭头颜色始终为 text
		const titleColor = props.api.theme.current.text
		if (titleNode !== undefined && titleNode.fg !== titleColor) titleNode.fg = titleColor
		if (arrowNode !== undefined && arrowNode.fg !== titleColor) arrowNode.fg = titleColor
		
		// SUBSTEP 缓冲动画图标：活动时显示并加载动画，闲置时隐藏；
		// 活动判据取自读数的 active 字段，与 prompt 单行的 colorFor 同一来源
		applySpinner(readout.active)
		
		// STEP 请求重绘
		props.api.renderer.requestRender()
		
	}
	
	// SUBSTEP 对外暴露的刷新入口
	const request = (now: number, force: boolean) => {
		if (! force && ! due(now)) return
		render(now, force)
		
	}
	
	// STEP 把刷新回调登记给宿主，并自报存活探针供 painters 回收已卸载实例
	props.register(props.sessionID, request, () => isAlive(titleNode))
	
	// STEP 计算缩进列数：把 sidebarIndent 字符串按终端显示宽度折算
	const indentCols = displayWidth(props.config.sidebarIndent)
	
	// STEP 渲染结构：垂直 box > 可点击标题行 + 每字段一个 row box
	return (
		<box flexDirection="column" flexShrink={0}>
			<box
				flexDirection="row"
				width="100%"
				justifyContent="space-between"
				gap={1}
				onMouseDown={() => toggle()}
			>
				{/* PART 左区：箭头、标题与折叠摘要三者的相对顺序与行为保持不变 */}
				<box flexDirection="row" gap={1}>
					<text
						fg={props.api.theme.current.text}
						ref={(ref: TextNode | undefined) => {
							arrowNode = ref
							// BRANCH 宿主允许回调收到 undefined (节点缺失)，此时不做任何节点成员写入
							if (arrowNode !== undefined) arrowNode.content = collapsed ? "▶" : "▼"
							tryFirstRender()
						}}
					>
						{""}
					</text>
					<text
						fg={props.api.theme.current.text}
						ref={(ref: TextNode | undefined) => {
							titleNode = ref
							// NOTE 命令式写 content 走 stringToStyledText：整串会被包成单个纯文本 chunk，
							// 不解析标签，所以这里只能写纯文本，不能加 <b> 等 markup
							if (titleNode !== undefined) titleNode.content = props.config.sidebarTitle
							tryFirstRender()
						}}
					>
						{""}
					</text>
					<text
						fg={props.api.theme.current.textMuted}
						ref={(ref: TextNode | undefined) => {
							summaryNode = ref
							if (summaryNode !== undefined) summaryNode.content = ""
							tryFirstRender()
						}}
					>
						{""}
					</text>
				</box>
				{/* PART 右区：缓冲动画图标，固定 2 列宽以吸收 braille 的 East Asian Ambiguous 宽度不确定性 */}
				{spinnerEnabled ? (
					<text
						fg={(props.api.theme.current as { accent?: ColorToken }).accent ?? props.api.theme.current.text}
						width={2}
						flexShrink={0}
						visible={spinnerActive}
						ref={(ref: TextNode) => {
							spinnerNode = ref
							spinner.spinnerNode = ref
							// STEP 首帧按当前活动态落一次显隐与首帧内容，避免节点以默认可见态残留
							applySpinner(spinnerActive)
						}}
					>
						{""}
					</text>
				) : undefined}
			</box>
			{props.config.items.map((field, index) => (
				<box
					width="100%"
					flexDirection="row"
					justifyContent={props.config.sidebarAlign ? "space-between" : undefined}
					columnGap={props.config.sidebarAlign ? undefined : 1}
					shouldFill={true}
					paddingLeft={indentCols}
					ref={(ref: BoxNode | undefined) => {
						fieldRows[index].boxNode = ref
						tryFirstRender()
					}}
				>
					<text
						fg={props.api.theme.current.textMuted}
						wrapMode="none"
						flexShrink={0}
						ref={(ref: TextNode | undefined) => {
							fieldRows[index].labelNode = ref
							tryFirstRender()
						}}
					>
						{""}
					</text>
					<text
						fg={props.api.theme.current.textMuted}
						wrapMode="none"
						truncate={true}
						flexShrink={1}
						ref={(ref: TextNode | undefined) => {
							fieldRows[index].valueNode = ref
							tryFirstRender()
						}}
					>
						{""}
					</text>
				</box>
			))}
		</box>
	)
	
}

// ===== ===== ===== ===== [插件入口] ===== ===== ===== =====

/**
 * 插件入口：解析配置、接线事件流、启动基准节拍并注册槽位与快捷键
 * @param {TuiPluginApi} api 插件 API
 * @param {Record<string, unknown> | undefined} options tui.json 传入的插件选项
 * @return {void} 无返回值
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
const tui: TuiPlugin = async (api, options) => {
	// STEP 重置模块级侧边栏状态，保证同一进程内重复加载时不会串状态
	sidebarCollapsedGlobal = undefined
	sidebarControllers.clear()
	sidebarTitles.clear()
	spinnerFrame = 0
	
	// STEP 解析配置并建立全局指标状态
	const config = resolveConfig(options as Record<string, unknown> | undefined)
	const state = freshState()
	
	// VAR 以 sessionID 为键的回调集合，同一会话可能同时挂载 prompt 行与侧边栏，
	// 用 Set 避免互相覆盖
	const painters = new Map<string, Set<Painter>>()
	const disposers: Array<() => void> = []
	
	// SUBSTEP 登记单个会话的刷新回调，可附带存活探针用于回收已卸载组件
	const registerPainter = (sessionID: string, request: (now: number, force: boolean) => void, alive?: () => boolean) => {
		let set = painters.get(sessionID)
		if (set === undefined) {
			set = new Set()
			painters.set(sessionID, set)
		}
		set.add({ request, alive })
		
	}
	
	// SUBSTEP 广播刷新：跳过已销毁组件的回调，全部已登记的存活回调各跑一遍
	const requestAll = (force: boolean) => {
		const now = Date.now()
		for (const set of painters.values()) {
			for (const painter of set) {
				if (! isAliveProbe(painter.alive)) continue
				painter.request(now, force)
			}
		}
		
	}
	
	// STEP 剔除已销毁组件的悬挂登记
	// </br>opentui 的 ref 回调不提供 unmount 通知，组件被「切换会话 / 收起侧边栏」这类
	// 路径卸载时只能靠节点的 isDestroyed 兜底回收，否则帧定时器会每 100ms 往死节点写内容，
	// 指标节拍会每 250ms 跑一遍无人观看的 buildReadout。判据缺失时一律按存活处理。
	const pruneDestroyed = () => {
		// SUBSTEP 逐会话剔除已销毁组件的刷新回调
		for (const [sessionID, set] of painters) {
			for (const painter of set) {
				if (! isAliveProbe(painter.alive)) set.delete(painter)
			}
			
			// STEP 该会话已无任何存活回调时，连键一起摘掉
			if (set.size === 0) painters.delete(sessionID)
			
		}
		
		// SUBSTEP 侧边栏两表同理：标题行节点被销毁即视为整块侧边栏已卸载
		for (const [sessionID, spinner] of sidebarTitles) {
			if (isAliveProbe(spinner.alive)) continue
			sidebarTitles.delete(sessionID)
			sidebarControllers.delete(sessionID)
		}
		
	}
	
	// STEP 接线事件流：消息类事件驱动指标引擎，状态类事件驱动 STS
	
	// SUBSTEP message.updated：user 锚定开轮 / assistant 开始与完成
	disposers.push(api.event.on("message.updated", (event) => {
		const info = event.properties.info
		const sessionID = event.properties.sessionID ?? info.sessionID
		if (sessionID === undefined) return
		
		// PART 用户消息：结算上一轮并开启新一轮 (单会话字段的重置只发生在这里；
		// 重复投递的 user 消息按 ID 幂等，不会把本轮读数提前清空)
		if (info.role === "user") {
			noteUserMessage(state, sessionID, info.time.created, info.id)
			requestAll(true)
			return
		}
		if (info.role !== "assistant") return
		
		// PART assistant 消息未带完成时间：开始流式输出
		if (info.time.completed === undefined) {
			noteAssistantStarted(state, sessionID, info.id, info.time.created)
			requestAll(true)
			return
		}
		
		// PART assistant 消息完成：权威值接管，按需弹 toast
		const tokens = noteAssistantFinished(state, sessionID, info.id, {
			completedAt: info.time.completed,
			outputTokens: info.tokens.output,
			reasoningTokens: info.tokens.reasoning,
			finish: info.finish,
			errored: ! (info.error === undefined),
		})
		if (config.toastOnComplete && tokens > 0) {
			const readout = buildReadout(state, sessionID, Date.now(), config)
			api.ui.toast({ message: composeLine(config.items.map((field) => ({ field, value: fieldValue(field, readout, config) })), config), variant: "info", duration: 5000 })
		}
		requestAll(true)
	}))
	
	// SUBSTEP message.part.delta：正文与思考流计入实时窗口 (高频走节流档)
	disposers.push(api.event.on("message.part.delta", (event) => {
		const kind = event.properties.field
		// STEP 只统计正文与思考流；工具参数增量不计入实时窗口
		if (kind !== "text" && kind !== "reasoning") return
		
		// STEP 按 UTF-8 字节数投递增量
		const bytes = new TextEncoder().encode(event.properties.delta).length
		noteTextDelta(state, event.properties.sessionID, event.properties.messageID, Date.now(), bytes)
		
		// NOTE 高频事件走节流档，采样节奏由 refresh 配置决定
		requestAll(false)
	}))
	
	// SUBSTEP message.part.updated：工具边界，丢弃实时窗口并记录收尾时间
	disposers.push(api.event.on("message.part.updated", (event) => {
		const part = event.properties.part
		if (part.type !== "tool") return
		
		// STEP 只认运行中 / 完成 / 出错三种工具状态
		const status = part.state === undefined ? undefined : (part.state as { status?: string }).status
		if (status !== "running" && status !== "completed" && status !== "error") return
		
		// STEP 登记工具边界并全量刷新
		noteToolBoundary(state, event.properties.sessionID, part.messageID, Date.now())
		requestAll(true)
	}))
	
	// SUBSTEP session.status：STS 状态机 (idle / busy / retry)
	disposers.push(api.event.on("session.status", (event) => {
		const status = event.properties.status
		noteStatus(state, event.properties.sessionID, {
			type: status.type,
			attempt: (status as { attempt?: number }).attempt,
		})
		requestAll(true)
	}))
	
	// SUBSTEP session.idle：冻结实时窗口，保留累计值
	disposers.push(api.event.on("session.idle", (event) => {
		noteIdle(state, event.properties.sessionID)
		requestAll(true)
	}))
	
	// SUBSTEP session.error：登记错误标记
	disposers.push(api.event.on("session.error", (event) => {
		noteError(state, event.properties.sessionID)
		requestAll(true)
	}))
	
	// SUBSTEP session.deleted：只有真删会话才释放状态
	disposers.push(api.event.on("session.deleted", (event) => {
		// NOTE 只有会话被真正删除才释放状态；挂机 / 切走一律保留读数
		// PART 保留 painters 中该会话的回调，让 prompt 行能在删除后渲染一次占位回落
		forgetSession(state, event.properties.sessionID)
		
		// STEP 先广播一次：此时 painter 仍在表里，能让界面把该会话刷新成占位回落。
		// 这一步必须排在下面的清理之前，否则节点会停留在删除前的旧读数上
		requestAll(true)
		
		// STEP 广播完成后再摘除全部悬挂登记：会话已释放，继续留着会让帧定时器
		// 每 100ms 往死节点写内容、指标节拍每 250ms 跑一遍无人观看的 buildReadout
		painters.delete(event.properties.sessionID)
		sidebarControllers.delete(event.properties.sessionID)
		sidebarTitles.delete(event.properties.sessionID)
	}))
	
	// STEP 启动基准节拍：三档字段各自判定到期，全部未到期的节拍是纯空转。
	// 每拍先回收已销毁组件的悬挂登记，否则它们的闭包会永远抓着死节点每 250ms 跑一遍
	const timer = setInterval(() => {
		pruneDestroyed()
		requestAll(false)
	}, TICK_MS)
	
	// STEP 启动独立的动画帧定时器：100ms 一帧，与 250ms 的指标节拍互不干扰，
	// 复用指标节拍会让 10 帧动画每拍跳 2~3 格，看起来是卡顿而非动画。
	// BRANCH sidebarSpinner=false 时整个定时器都不启动，省掉 100ms 一次的无谓空转
	let spinnerTimer: ReturnType<typeof setInterval> | undefined
	if (config.sidebarSpinner) {
		spinnerTimer = setInterval(() => {
			// STEP 先剔除已销毁组件的悬挂登记：ref 回调拿不到 unmount 通知，
			// 组件被「切换会话 / 收起侧边栏」这类路径卸载时只能靠 isDestroyed 兜底回收
			pruneDestroyed()
			
			// BRANCH 空闲门控：没有任何侧边栏实例处于活动态时直接返回，
			// 既不写节点也不 requestRender，避免空转时白烧 CPU
			let hasActive = false
			for (const spinner of sidebarTitles.values()) {
				if (spinner.active) {
					hasActive = true
					break
				}
			}
			if (! hasActive) return
			
			// STEP 帧号前进一格并取对应字符
			spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length
			const frame = SPINNER_FRAMES[spinnerFrame]
			
			// STEP 只给活动态且节点已就位并仍存活的实例写内容
			for (const spinner of sidebarTitles.values()) {
				if (! spinner.active) continue
				if (spinner.spinnerNode === undefined) continue
				if (! isAlive(spinner.spinnerNode)) continue
				spinner.spinnerNode.content = frame
			}
			
			// STEP 命令式改写节点后必须显式请求重绘，否则不会真正画出来
			api.renderer.requestRender()
		}, SPINNER_FRAME_MS)
	}
	
	// STEP 注册 prompt 行槽位：只在用户显式保留 "prompt" 时注册，保持向后兼容
	if (config.locations.includes("prompt")) {
		api.slots.register({
			order: 20,
			slots: {
				session_prompt_right(_ctx, props) {
					return (
						<StatusRow
							api={api}
							sessionID={props.session_id}
							state={state}
							config={config}
							register={registerPainter}
						/>
					)
				},
			},
		})
	}
	
	// STEP 注册侧边栏槽位：只在用户保留 "sidebar" 时注册；
	// content 用 order 50 排在内置 Context 之上，footer 用 order 200 压过内置版本号
	if (config.locations.includes("sidebar")) {
		const isFooter = config.sidebarSlot === "footer"
		const slotName = isFooter ? "sidebar_footer" : "sidebar_content"
		api.slots.register({
			order: isFooter ? 200 : 50,
			slots: {
				[slotName](_ctx, props) {
					return (
						<SidebarSection
							api={api}
							sessionID={props.session_id}
							state={state}
							config={config}
							register={registerPainter}
						/>
					)
				},
			},
		})
	}
	
	// STEP 注册命令面板命令与默认键位
	// 默认键位选 ctrl+shift+m：M 对应 Metrics，带 shift 修饰避免与宿主直接 ctrl 序列冲突；
	// 宿主把 <leader>（ctrl+x）用于 session.sidebar.toggle 等序列，本键不经过 leader，不会撞车
	disposers.push(api.keymap.registerLayer({
		name: "my-opencode-tps-tui1.sidebar",
		bindings: [{ key: "ctrl+shift+m", cmd: "my-opencode-tps-tui1.sidebar.toggle" }],
		commands: [{
			name: "my-opencode-tps-tui1.sidebar.toggle",
			title: "Toggle Metrics Sidebar",
			category: "Plugin",
			namespace: "palette",
			run() {
				// STEP 计算新状态并同步到 kv
				const next = ! sidebarCollapsedGlobal
				sidebarCollapsedGlobal = next
				api.kv.set(KV_KEY, next)
				
				// STEP 穿透到所有已挂载的侧边栏实例
				for (const controller of sidebarControllers.values()) {
					controller.setCollapsed(next)
				}
				
				// STEP 请求重绘
				api.renderer.requestRender()
			},
		}],
	}))
	
	// STEP 注册清理：退订全部事件、清空回调表、停掉节拍定时器与动画帧定时器
	api.lifecycle.onDispose(() => {
		for (const dispose of disposers) dispose()
		painters.clear()
		sidebarControllers.clear()
		sidebarTitles.clear()
		clearInterval(timer)
		
		// BRANCH 开关关闭时帧定时器压根没启动，无需清理
		if (spinnerTimer !== undefined) clearInterval(spinnerTimer)
	})
	
}

/** CONST 插件模块出口：带 id 的 TUI 插件模块 */
const plugin: TuiPluginModule & { id: string } = {
	id: "my-opencode-tps-tui1",
	tui,
}

export default plugin
