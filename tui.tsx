/** @jsxImportSource @opentui/solid */
/**
 * my-opencode-tps-tui1 — OpenCode 1.x TUI 插件
 *
 * 在 session_prompt_right 槽位渲染一行指标：
 *   TPS 60.3 | AVG_TPS 104 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 8.50s |
 *   AVG_TTFT 9.50s | DUR 2m57s | TOTAL_DUR 26m45s | STS Waiting...
 *
 * 设计要点：
 *   - 指标全部来自 OpenCode 公开事件流，只有实时窗口用字节估算并自校准
 *   - 整行只有一个 <text> 节点：字段拼进同一个字符串，间距由文本自身空格
 *     决定，不再受 flex gap 影响，拖拽选中时是完整一块
 *   - 刷新走命令式：ref 拿到 text 节点后直接改 content / fg 再 requestRender
 *   - 三档刷新（live / count / clock）共用一个基准节拍，字段各自到期才取值，
 *     内容真变化才 requestRender，空转节拍没有重绘开销
 *   - 会话忙时耗时逐秒增长、结算即冻结；空闲只冻结实时窗口，累计值不清零
 *
 * WARN 本文件绝不能出现来自 "solid-js" 的裸导入
 *   OpenCode 只重写 @opentui/solid 这类子路径 specifier，裸 specifier 会照常解析；
 *   而插件目录一旦装出 node_modules，@opentui/solid 会拉起第二份 @opentui/core，
 *   与宿主抢注环境变量 OPENTUI_FORCE_WCWIDTH 直接抛错，插件会被静默丢弃
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
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

/** VAR 基准调度粒度：所有刷新档位都在这个节拍上对齐 */
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

/**
 * 决定整行颜色
 *
 * colorize 开启时：会话忙（有活动）整行高亮为主题强调色，静止回落弱化色；
 * 关闭时恒为弱化色。
 *
 * @param {} readout 读数，尚未产生时视为静止
 * @param {} config 配置
 * @param {} api 插件 API
 * @return {} 颜色令牌
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
function colorFor(readout: Readout | undefined, config: ResolvedConfig, api: TuiPluginApi): ColorToken {
	const theme = api.theme.current
	if (! config.colorize) return theme.textMuted
	// BRANCH 有活动（busy）整行高亮，静止回落灰色
	return readout !== undefined && readout.active ? theme.text : theme.textMuted;

}

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

	const intervalOf = (field: FieldName) => props.config.refresh[FIELD_TIER[field]]

	const due = (now: number) => {
		for (const slot of slots) {
			if ((now - slot.at) >= intervalOf(slot.field)) return true
		}
		return false

	}

	const render = (now: number, force: boolean) => {
		const readout = buildReadout(props.state, props.sessionID, now, props.config)
		for (const slot of slots) {
			// STEP 只在字段所属档位到期（或强制）时重新取值，未到期沿用旧值，
			// 计数类字段因此不会被高频事件带着抖动
			if (! force && (now - slot.at) < intervalOf(slot.field)) continue
			slot.value = fieldValue(slot.field, readout, props.config)
			slot.at = now
		}
		if (node === undefined) return
		let dirty = false
		const line = composeLine(slots, props.config)
		if (line !== lastLine) {
			lastLine = line
			node.content = line
			dirty = true
		}
		const color = colorFor(readout, props.config, props.api)
		if (color !== lastColor) {
			lastColor = color
			node.fg = color
			dirty = true
		}
		// STEP 内容真的变化才请求重绘，空转节拍不产生任何渲染开销
		if (dirty) props.api.renderer.requestRender()

	}

	const request = (now: number, force: boolean) => {
		if (! force && ! due(now)) return
		render(now, force)

	}

	props.register(props.sessionID, request)

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

const tui: TuiPlugin = async (api, options) => {
	const config = resolveConfig(options as Record<string, unknown> | undefined)
	const state = freshState()
	// VAR 以 sessionID 为键，避免同一会话重复注册导致回调堆积
	const painters = new Map<string, (now: number, force: boolean) => void>()
	const disposers: Array<() => void> = []

	const requestAll = (force: boolean) => {
		const now = Date.now()
		for (const request of painters.values()) request(now, force)

	}

	disposers.push(api.event.on("message.updated", (event) => {
		const info = event.properties.info
		const sessionID = event.properties.sessionID ?? info.sessionID
		if (sessionID === undefined) return

		// BRANCH 用户消息：结算上一轮并开启新一轮（单会话字段的重置只发生在这里；
		// 重复投递的 user 消息按 ID 幂等，不会把本轮读数提前清空）
		if (info.role === "user") {
			noteUserMessage(state, sessionID, info.time.created, info.id)
			requestAll(true)
			return
		}
		if (info.role !== "assistant") return

		if (info.time.completed === undefined) {
			noteAssistantStarted(state, sessionID, info.id, info.time.created)
			requestAll(true)
			return
		}

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

	disposers.push(api.event.on("message.part.delta", (event) => {
		const kind = event.properties.field
		// STEP 只统计正文与思考流；工具参数增量不计入实时窗口
		if (kind !== "text" && kind !== "reasoning") return
		const bytes = new TextEncoder().encode(event.properties.delta).length
		noteTextDelta(state, event.properties.sessionID, event.properties.messageID, Date.now(), bytes)
		// NOTE 高频事件走节流档，采样节奏由 refresh 配置决定
		requestAll(false)
	}))

	disposers.push(api.event.on("message.part.updated", (event) => {
		const part = event.properties.part
		if (part.type !== "tool") return
		const status = part.state === undefined ? undefined : (part.state as { status?: string }).status
		if (status !== "running" && status !== "completed" && status !== "error") return
		noteToolBoundary(state, event.properties.sessionID, part.messageID, Date.now())
		requestAll(true)
	}))

	disposers.push(api.event.on("session.status", (event) => {
		const status = event.properties.status
		noteStatus(state, event.properties.sessionID, {
			type: status.type,
			attempt: (status as { attempt?: number }).attempt,
		})
		requestAll(true)
	}))

	disposers.push(api.event.on("session.idle", (event) => {
		noteIdle(state, event.properties.sessionID)
		requestAll(true)
	}))

	disposers.push(api.event.on("session.error", (event) => {
		noteError(state, event.properties.sessionID)
		requestAll(true)
	}))

	disposers.push(api.event.on("session.deleted", (event) => {
		// NOTE 只有会话被真正删除才释放状态；挂机 / 切走一律保留读数
		forgetSession(state, event.properties.sessionID)
		requestAll(true)
	}))

	const timer = setInterval(() => {
		// STEP 基准节拍：三档字段各自判定到期，全部未到期的节拍是纯空转
		requestAll(false)
	}, TICK_MS)

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

	api.lifecycle.onDispose(() => {
		for (const dispose of disposers) dispose()
		painters.clear()
		clearInterval(timer)
	})

}

const plugin: TuiPluginModule & { id: string } = {
	id: "my-opencode-tps-tui1",
	tui,
}

export default plugin
