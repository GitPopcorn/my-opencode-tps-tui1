/**
 * 指标引擎：把 OpenCode 公开事件流折算成 TPS / TOKEN / 时延读数
 *
 * 事件来源（OpenCode 1.x TUI 事件总线）：
 *   - message.updated                         消息创建 / 完成 / 权威 token 用量 / 错误
 *   - message.part.delta (field=text|reasoning) 实时流式窗口
 *   - message.part.updated (tool)             工具边界，丢弃过期窗口并记录收尾时间
 *   - session.status / session.idle            STS 状态
 *   - session.error / session.deleted          错误与释放
 *
 * 关键口径：
 *   - 一轮对话（Turn）= 一条 user 消息 + 其后的全部 assistant / 工具步骤
 *   - 生成时长（activeMs）= 每条消息「首个文本增量 → 结束」，排除工具停顿
 *   - 本轮耗时（wall）= 请求发出 → 本轮最后一条消息完成，含工具执行
 *   - AVG_TPS 用累计输出词元 / 累计生成时长；DUR / TOTAL_DUR 用 wall 口径，
 *     会话忙时按当前时间逐秒增长，结算后冻结在结算值
 *   - 会话空闲只冻结实时窗口，不清理任何累计值
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

import type { ResolvedConfig } from "./config.js";

/** VAR 实时滚动窗口宽度 */
const STREAM_WINDOW_MS = 5000;
/** VAR 实时窗口至少累计这么久才出读数，避免首包尖峰 */
const LIVE_MIN_MS = 1000;
/** VAR 冷启动的字节/词元估算比例 */
const DEFAULT_BYTES_PER_TOKEN = 5;
/** VAR 自校准比例的上下限 */
const MIN_BYTES_PER_TOKEN = 2;
const MAX_BYTES_PER_TOKEN = 8;
/** VAR 自校准的指数平滑权重（新样本占比） */
const CALIBRATION_WEIGHT = 0.5;

export type MessageTiming = {
	requestStartAt: number;
	firstTextAt?: number;
	lastTextAt?: number;
	lastToolCallAt?: number;
	streamedBytes: number;
};

export type Turn = {
	requestStartAt?: number;
	lastCompletedAt?: number;
	tokens: number;
	activeMs: number;
	ttftMs?: number;
	responses: number;
	/** VAR 尚未结算消息的在飞字节，用于流式中的 TOKEN 实时估算 */
	pendingBytes: number;
	/** VAR 本轮已展示的词元峰值，防止流式估算回落（完成后回到权威值） */
	peakTokens: number;
	/** VAR 本轮最后一条完成消息的结束原因；tool-calls 表示工具续跑、轮未关闭 */
	lastFinish?: string;
};

export type Committed = {
	tokens: number;
	activeMs: number;
	wallMs: number;
	ttftSumMs: number;
	ttftCount: number;
};

export type LastMessage = {
	tokens: number;
	activeMs: number;
	ttftMs?: number;
};

/** VAR STS 状态机取值，unknown 表示尚未收到任何状态事件 */
export type StatusKind = "unknown" | "idle" | "busy" | "retry";

export type SessionMetrics = {
	timing: Record<string, MessageTiming>;
	finalized: Set<string>;
	/** VAR 已见过的 user 消息 ID：user 消息的 updated 事件会重复投递，必须幂等 */
	userMessages: Set<string>;
	live?: { since: number; bytes: number };
	turn: Turn;
	committed: Committed;
	lastMessage?: LastMessage;
	bytesPerToken: number;
	calibrated: boolean;
	status: StatusKind;
	retryAttempt?: number;
	errored: boolean;
	seen: boolean;
};

export type MetricsState = {
	sessions: Record<string, SessionMetrics>;
};

/** VAR 渲染层最终消费的读数 */
export type Readout = {
	tps?: number;
	avgTps?: number;
	tokens?: number;
	totalTokens?: number;
	ttftMs?: number;
	avgTtftMs?: number;
	durMs?: number;
	totalDurMs?: number;
	status: string;
	streaming: boolean;
	active: boolean;
};

function freshTurn(): Turn {
	return { tokens: 0, activeMs: 0, responses: 0, pendingBytes: 0, peakTokens: 0 };

}

function freshCommitted(): Committed {
	return { tokens: 0, activeMs: 0, wallMs: 0, ttftSumMs: 0, ttftCount: 0 };

}

function freshSession(): SessionMetrics {
	return {
		timing: {},
		finalized: new Set<string>(),
		userMessages: new Set<string>(),
		turn: freshTurn(),
		committed: freshCommitted(),
		bytesPerToken: DEFAULT_BYTES_PER_TOKEN,
		calibrated: false,
		status: "unknown",
		errored: false,
		seen: false,
	};

}

/**
 * 创建空的指标状态
 *
 * @return {} 空的 MetricsState
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function freshState(): MetricsState {
	return { sessions: {} };

}

/**
 * 取（必要时创建）某个会话的指标状态
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @return {} 会话指标
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function getSession(state: MetricsState, sessionID: string): SessionMetrics {
	const existing = state.sessions[sessionID];
	if (! (existing === undefined)) return existing;
	const created = freshSession();
	state.sessions[sessionID] = created;
	return created;

}

/**
 * 释放某个会话的状态
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function forgetSession(state: MetricsState, sessionID: string): void {
	delete state.sessions[sessionID];

}

/** 本轮 wall 耗时（冻结口径）：请求发出 → 本轮最后一条消息完成，缺失时回落到生成时长 */
function turnWallMs(turn: Turn): number {
	if (turn.requestStartAt === undefined || turn.lastCompletedAt === undefined) return turn.activeMs;
	return Math.max(turn.lastCompletedAt - turn.requestStartAt, turn.activeMs);

}

/**
 * 本轮 wall 耗时（实时口径）
 *
 * 会话忙时用当前时间推算，让耗时逐秒可见（真人执行中需要时间感知）；
 * 结算后（非 busy）回落到冻结口径，固定展示结算值。
 *
 * @param {} turn 本轮状态
 * @param {} now 当前时间
 * @param {} running 会话是否忙
 * @return {} wall 毫秒数
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
function liveWallMs(turn: Turn, now: number, running: boolean): number {
	if (! running) return turnWallMs(turn);
	if (turn.requestStartAt === undefined) return turn.activeMs;
	return Math.max(now - turn.requestStartAt, turn.activeMs);

}

/** 把当前轮结算进累计值。空轮不产生任何影响，避免污染 AVG_TTFT */
function commitTurn(session: SessionMetrics): void {
	const turn = session.turn;
	const empty = (turn.responses === 0) && (turn.tokens === 0) && (turn.ttftMs === undefined);
	if (empty) return;
	session.committed.tokens += turn.tokens;
	session.committed.activeMs += turn.activeMs;
	session.committed.wallMs += turnWallMs(turn);
	if (! (turn.ttftMs === undefined)) {
		session.committed.ttftSumMs += turn.ttftMs;
		session.committed.ttftCount += 1;
	}

}

/**
 * 轮是否已真正关闭
 *
 * 有完成时间且最后一条消息不是工具续跑（tool-calls）才算关闭；
 * 进行中的轮 / 空轮一律视为未关闭 —— 期间到达的任何 user 消息
 * （重复投递、平台合成消息）都不得清轮，否则单轮读数会被锯齿清零。
 *
 * @param {} turn 本轮状态
 * @return {} true 表示已关闭，下一条 assistant 消息将开启新一轮
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
function turnClosed(turn: Turn): boolean {
	if (turn.lastCompletedAt === undefined) return false;
	return turn.lastFinish !== "tool-calls";

}

/** 关闭旧轮并开启新轮：结算累计、重置单轮字段 */
function rollTurn(session: SessionMetrics): void {
	commitTurn(session);
	session.turn = freshTurn();
	session.lastMessage = undefined;
	session.errored = false;

}

/** 用一条已完成消息的真实词元数反向校准字节/词元比例 */
function calibrate(session: SessionMetrics, ratio: number): void {
	if (! Number.isFinite(ratio) || ratio <= 0) return;
	const clamped = Math.min(Math.max(ratio, MIN_BYTES_PER_TOKEN), MAX_BYTES_PER_TOKEN);
	// STEP 指数平滑，避免单条消息把比例带偏
	session.bytesPerToken = session.calibrated
		? (session.bytesPerToken * (1 - CALIBRATION_WEIGHT)) + (clamped * CALIBRATION_WEIGHT)
		: clamped;
	session.calibrated = true;

}

/**
 * 记录一条用户消息：仅做起点锚定，绝不可靠的清轮信号
 *
 * WARN OpenCode 会重复投递 user 消息、也会发出平台合成的"新"user 消息，
 * 把清轮寄托在 user 事件上会导致轮进行中被锯齿清零（实测踩坑两次）。
 * 因此这里只在上一轮真正关闭时才结算开新轮，其余情况仅锚定请求起点。
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} createdAt 用户消息创建时间
 * @param {} messageID 用户消息 ID，用于重复投递去重
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteUserMessage(state: MetricsState, sessionID: string, createdAt: number, messageID?: string): void {
	const session = getSession(state, sessionID);
	session.seen = true;
	// STEP 幂等：重复投递的 user 消息完全忽略
	if (! (messageID === undefined)) {
		if (session.userMessages.has(messageID)) return;
		session.userMessages.add(messageID);
	}
	// BRANCH 只有上一轮真正关闭才结算开新轮；轮进行中绝不清
	if (turnClosed(session.turn)) rollTurn(session);
	if (session.turn.requestStartAt === undefined) session.turn.requestStartAt = createdAt;

}

/**
 * 记录一条 assistant 消息开始流式输出
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} messageID 消息 ID
 * @param {} createdAt 消息创建时间
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteAssistantStarted(state: MetricsState, sessionID: string, messageID: string, createdAt: number): void {
	const session = getSession(state, sessionID);
	session.seen = true;
	// BRANCH 上一轮已真正关闭（非工具续跑）→ 本条是新一轮的第一条消息，先结算开新轮
	if (turnClosed(session.turn)) rollTurn(session);
	const existing = session.timing[messageID];
	session.timing[messageID] = {
		requestStartAt: existing === undefined ? createdAt : existing.requestStartAt,
		firstTextAt: existing === undefined ? undefined : existing.firstTextAt,
		lastTextAt: existing === undefined ? undefined : existing.lastTextAt,
		lastToolCallAt: existing === undefined ? undefined : existing.lastToolCallAt,
		streamedBytes: existing === undefined ? 0 : existing.streamedBytes,
	};
	// NOTE 插件可能在中途加载，用消息自身创建时间兜底本轮起点
	if (session.turn.requestStartAt === undefined) session.turn.requestStartAt = createdAt;

}

/**
 * 记录一段流式增量（text 或 reasoning）
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} messageID 消息 ID
 * @param {} at 观测时间
 * @param {} bytes 增量字节数
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteTextDelta(state: MetricsState, sessionID: string, messageID: string, at: number, bytes: number): void {
	const session = getSession(state, sessionID);
	const timing = session.timing[messageID];
	if (! (timing === undefined)) {
		if (timing.firstTextAt === undefined) timing.firstTextAt = at;
		timing.lastTextAt = at;
		timing.streamedBytes += bytes;
		// STEP 在飞字节累计：流式过程中 TOKEN 的实时估算来源，
		// 消息完成后由权威词元替代（见 noteAssistantFinished）
		session.turn.pendingBytes += bytes;
		// STEP 首字即锚定 TTFT，让流式期间也能实时看到（完成时不再覆盖）
		if (session.turn.ttftMs === undefined) {
			session.turn.ttftMs = Math.max(timing.firstTextAt - timing.requestStartAt, 0);
		}
	}
	// STEP 维护滚动窗口，超过窗口宽度则重新开窗
	const window = session.live;
	if (window === undefined || (at - window.since) > STREAM_WINDOW_MS) {
		session.live = { since: at, bytes };
		return;
	}
	window.bytes += bytes;

}

/**
 * 记录工具边界
 *
 * 工具执行期间不会有流式增量，留着旧窗口会把停顿算成低 TPS，因此直接丢弃。
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} messageID 消息 ID
 * @param {} at 观测时间
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteToolBoundary(state: MetricsState, sessionID: string, messageID: string, at: number): void {
	const session = getSession(state, sessionID);
	delete session.live;
	const timing = session.timing[messageID];
	if (! (timing === undefined)) {
		if (! (timing.firstTextAt === undefined)) timing.lastToolCallAt = at;
	}

}

export type FinishInput = {
	completedAt: number;
	outputTokens: number;
	reasoningTokens: number;
	finish?: string;
	errored: boolean;
};

/**
 * 记录一条 assistant 消息完成
 *
 * 该事件可能重复触发，用 finalized 集合做幂等保护。
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} messageID 消息 ID
 * @param {} input 完成时携带的用量与结束原因
 * @return {} 本轮词元增量，供调用方决定是否弹提示
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteAssistantFinished(state: MetricsState, sessionID: string, messageID: string, input: FinishInput): number {
	const session = getSession(state, sessionID);
	session.seen = true;
	// WARN 该事件会重复触发，必须去重，否则词元会被重复累加
	if (session.finalized.has(messageID)) return 0;
	session.finalized.add(messageID);

	const tokens = input.outputTokens + input.reasoningTokens;
	const timing = session.timing[messageID];
	let activeMs = 0;
	let ttftMs: number | undefined;
	if (! (timing === undefined) && ! (timing.firstTextAt === undefined)) {
		// BRANCH 工具续跑的消息在最后一次工具调用处收尾，普通回答用服务端完成时间
		const endAt = input.finish === "tool-calls" && ! (timing.lastToolCallAt === undefined)
			? timing.lastToolCallAt
			: input.completedAt;
		activeMs = Math.max(endAt - timing.firstTextAt, 1);
		ttftMs = Math.max(timing.firstTextAt - timing.requestStartAt, 0);
		// STEP 只对没有工具续跑的消息做自校准，避免工具参数词元混入比例
		if (input.finish !== "tool-calls" && tokens > 0 && timing.streamedBytes > 0) {
			calibrate(session, timing.streamedBytes / tokens);
		}
	}

	session.turn.tokens += tokens;
	session.turn.activeMs += activeMs;
	session.turn.responses += 1;
	session.turn.lastCompletedAt = input.completedAt;
	session.turn.lastFinish = input.finish;
	// STEP 权威值接管：在飞字节清零，峰值回落到权威累计，避免估算高估被永久保留
	session.turn.pendingBytes = 0;
	session.turn.peakTokens = session.turn.tokens;
	if (! (ttftMs === undefined) && session.turn.ttftMs === undefined) session.turn.ttftMs = ttftMs;
	session.lastMessage = { tokens, activeMs, ttftMs };
	if (input.errored) session.errored = true;

	delete session.timing[messageID];
	delete session.live;
	return tokens;

}

/**
 * 记录会话状态变化
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} status 状态对象
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteStatus(state: MetricsState, sessionID: string, status: { type: string; attempt?: number }): void {
	const session = getSession(state, sessionID);
	session.seen = true;
	// BRANCH 状态机的三种取值：idle / busy / retry
	if (status.type === "idle" || status.type === "busy" || status.type === "retry") {
		session.status = status.type;
	}
	if (status.type === "retry") session.retryAttempt = status.attempt;
	if (status.type === "busy") session.errored = false;

}

/**
 * 记录会话空闲
 *
 * 只冻结实时窗口，绝不清理累计值，保证挂机回来仍能读到上一轮数据。
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteIdle(state: MetricsState, sessionID: string): void {
	const session = getSession(state, sessionID);
	session.status = "idle";
	delete session.live;

}

/**
 * 记录会话错误
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID，缺失时忽略
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function noteError(state: MetricsState, sessionID: string | undefined): void {
	if (sessionID === undefined) return;
	const session = getSession(state, sessionID);
	session.errored = true;

}

/** 实时速率：窗口有效时给出读数，过期即回收窗口 */
function liveRate(session: SessionMetrics, now: number): number | undefined {
	const window = session.live;
	if (window === undefined) return undefined;
	const elapsed = now - window.since;
	if (elapsed < LIVE_MIN_MS || window.bytes <= 0) return undefined;
	if (elapsed > STREAM_WINDOW_MS) {
		delete session.live;
		return undefined;
	}
	const tokens = Math.ceil(window.bytes / session.bytesPerToken);
	return tokens / (elapsed / 1000);

}

function statusText(session: SessionMetrics, config: ResolvedConfig, streaming: boolean): string {
	const text = config.sts;
	if (session.errored) return text.error;
	if (session.status === "retry") {
		const attempt = session.retryAttempt === undefined ? 1 : session.retryAttempt;
		return text.retrying.replace("{n}", String(attempt));
	}
	if (session.status === "busy") return streaming ? text.streaming : text.waiting;
	if (session.status === "idle") return text.idle;
	return text.unknown;

}

/**
 * 汇总某个会话当前应展示的读数
 *
 * @param {} state 全局状态
 * @param {} sessionID 会话 ID
 * @param {} now 当前时间
 * @param {} config 解析后的配置
 * @return {} 读数；会话不存在时全部为空
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function buildReadout(state: MetricsState, sessionID: string, now: number, config: ResolvedConfig): Readout {
	const session = state.sessions[sessionID];
	if (session === undefined) {
		return { status: config.sts.unknown, streaming: false, active: false };
	}

	const live = config.liveEstimate ? liveRate(session, now) : undefined;
	// STEP 本轮词元：已完成消息的权威值 + 在飞字节的估算，流式中取峰值防止回落，
	// 消息完成后回到权威累计（commitTurn / freshTurn 时峰值自然归零）
	const inflight = config.liveEstimate && session.turn.pendingBytes > 0
		? Math.ceil(session.turn.pendingBytes / session.bytesPerToken)
		: 0;
	session.turn.peakTokens = Math.max(session.turn.peakTokens, session.turn.tokens + inflight);
	const totalTokens = session.committed.tokens + session.turn.peakTokens;
	const totalActiveMs = session.committed.activeMs + session.turn.activeMs;
	const turnActiveMs = session.turn.activeMs;
	const turnTokens = session.turn.peakTokens;

	// STEP 单次读数：按 scope 决定取「本轮」还是「最近一条消息」
	const useMessage = config.scope === "message" && ! (session.lastMessage === undefined);
	const tokens = useMessage ? session.lastMessage!.tokens : turnTokens;
	const ttftMs = useMessage ? session.lastMessage!.ttftMs : session.turn.ttftMs;

	// STEP TPS：有实时窗口用实时值，否则回落到本轮均值，避免空闲后显示占位符
	let tps = live;
	if (tps === undefined && turnActiveMs > 0 && turnTokens > 0) tps = turnTokens / (turnActiveMs / 1000);

	// STEP AVG_TPS：累计输出词元 / 累计生成时长
	const avgTps = totalActiveMs > 0 && totalTokens > 0 ? totalTokens / (totalActiveMs / 1000) : undefined;

	// STEP AVG_TTFT：各轮 TTFT 的算术平均
	const currentTtft = session.turn.ttftMs;
	const ttftSumMs = session.committed.ttftSumMs + (currentTtft === undefined ? 0 : currentTtft);
	const ttftCount = session.committed.ttftCount + (currentTtft === undefined ? 0 : 1);
	const avgTtftMs = ttftCount > 0 ? ttftSumMs / ttftCount : undefined;

	// STEP 耗时实时口径：忙时逐秒增长（对齐 OpenChamber 等 Harness 的体验），
	// 结算后（非 busy）冻结在结算值；idle 挂机回来读到的就是定格值
	const running = session.status === "busy";
	const turnWall = liveWallMs(session.turn, now, running);
	const durMs = useMessage ? session.lastMessage!.activeMs : turnWall;
	const totalWallMs = session.committed.wallMs + turnWall;
	const showZeros = session.seen;

	return {
		tps,
		avgTps,
		tokens: (tokens > 0 || showZeros) ? tokens : undefined,
		totalTokens: (totalTokens > 0 || showZeros) ? totalTokens : undefined,
		ttftMs,
		avgTtftMs,
		durMs: durMs > 0 ? durMs : undefined,
		totalDurMs: totalWallMs > 0 ? totalWallMs : undefined,
		status: statusText(session, config, live !== undefined),
		streaming: live !== undefined,
		active: running,
	};

}
