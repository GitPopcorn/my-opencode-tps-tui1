/** @jsxImportSource @opentui/solid */
/**
 * my-opencode-tps-tui1 — OpenCode 1.x TUI 插件
 * </br>在 session_prompt_right 槽位渲染一行指标：
 * <pre><code>
 *     TPS 60.3 | AVG_TPS 104 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 8.50s |
 *     AVG_TTFT 9.50s | DUR 2m57s | TOTAL_DUR 26m45s | STS Waiting...
 * </code></pre>
 * </br>设计要点：
 * <ul>
 *     <li>指标全部来自 OpenCode 公开事件流，只有实时窗口用字节估算并自校准</li>
 *     <li>整行只有一个 <code><text></code> 节点：字段拼进同一个字符串，间距由文本自身空格
 *     决定，不再受 flex gap 影响，拖拽选中时是完整一块</li>
 *     <li>刷新走命令式：ref 拿到 text 节点后直接改 content / fg 再 requestRender</li>
 *     <li>三档刷新 (live / count / clock) 共用一个基准节拍，字段各自到期才取值，
 *     内容真变化才 requestRender，空转节拍没有重绘开销</li>
 *     <li>会话忙时耗时逐秒增长、结算即冻结；空闲只冻结实时窗口，累计值不清零</li>
 * </ul>
 * </br>WARN 本文件绝不能出现来自 "solid-js" 的裸导入：
 * OpenCode 只重写 @opentui/solid 这类子路径 specifier，裸 specifier 会照常解析；
 * 而插件目录一旦装出 node_modules，@opentui/solid 会拉起第二份 @opentui/core，
 * 与宿主抢注环境变量 OPENTUI_FORCE_WCWIDTH 直接抛错，插件会被静默丢弃
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { FIELD_TIER, resolveConfig, type FieldName, type ResolvedConfig } from "./src/config.js"
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
import { composeLine, fieldValue } from "./src/render.js"

// ===== ===== ===== ===== [常量与类型] ===== ===== ===== =====

/** CONST 基准调度粒度：所有刷新档位都在这个节拍上对齐 */
const TICK_MS = 250

/** VAR 可被命令式改写的文本节点最小形态 */
type TextNode = {
	content: string
	fg?: unknown
}

/** VAR 主题色令牌：宿主主题返回 RGBA 对象，fg 属性同样接受它 */
type ColorToken = string | object

/** VAR 单字段的采样缓存：所属档位到期才重新取值，未到期沿用旧值 */
type FieldSlot = {
	field: FieldName
	value: string
	at: number
}

// ===== ===== ===== ===== [组件] ===== ===== ===== =====

/**
 * 决定整行颜色
 * </br>colorize 开启时：会话忙 (有活动) 整行高亮为主题强调色，静止回落弱化色；
 * 关闭时恒为弱化色
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
 * 内容真变化才改写节点并 requestRender
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
	register: (sessionID: string, request: (now: number, force: boolean) => void) => void
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
	
	// STEP 把刷新回调登记给宿主 (以 sessionID 为键，避免重复注册堆积)
	props.register(props.sessionID, request)
	
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

// ===== ===== ===== ===== [插件入口] ===== ===== ===== =====

/**
 * 插件入口：解析配置、接线事件流、启动基准节拍并注册槽位
 * @param {TuiPluginApi} api 插件 API
 * @param {Record<string, unknown> | undefined} options tui.json 传入的插件选项
 * @return {void} 无返回值
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
const tui: TuiPlugin = async (api, options) => {
	// STEP 解析配置并建立全局指标状态
	const config = resolveConfig(options as Record<string, unknown> | undefined)
	const state = freshState()
	
	// VAR 以 sessionID 为键，避免同一会话重复注册导致回调堆积
	const painters = new Map<string, (now: number, force: boolean) => void>()
	const disposers: Array<() => void> = []
	
	// SUBSTEP 广播刷新：全部已登记的 request 回调各跑一遍
	const requestAll = (force: boolean) => {
		const now = Date.now()
		for (const request of painters.values()) request(now, force)
		
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
		forgetSession(state, event.properties.sessionID)
		requestAll(true)
	}))
	
	// STEP 启动基准节拍：三档字段各自判定到期，全部未到期的节拍是纯空转
	const timer = setInterval(() => {
		requestAll(false)
	}, TICK_MS)
	
	// STEP 注册槽位：session_prompt_right 渲染状态行，刷新回调按会话登记
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
						register={(sessionID: string, request: (now: number, force: boolean) => void) => {
							painters.set(sessionID, request)
						}}
					/>
				)
			},
		},
	})
	
	// STEP 注册清理：退订全部事件、清空回调表、停掉节拍定时器
	api.lifecycle.onDispose(() => {
		for (const dispose of disposers) dispose()
		painters.clear()
		clearInterval(timer)
	})
	
}

/** CONST 插件模块出口：带 id 的 TUI 插件模块 */
const plugin: TuiPluginModule & { id: string } = {
	id: "my-opencode-tps-tui1",
	tui,
}

export default plugin
