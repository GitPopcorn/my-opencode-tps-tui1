/**
 * 插件配置解析
 *
 * 所有显示项由 items 数组汇总：既决定显示哪些字段，也决定显示顺序。
 * 解析时会去重、丢弃未知字段，并在结果为空时回落到默认全展示。
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

/** VAR 支持的显示字段 */
export const FIELD_ORDER = [
	"TPS",
	"AVG_TPS",
	"TOKEN",
	"TOTAL_TK",
	"TTFT",
	"AVG_TTFT",
	"DUR",
	"TOTAL_DUR",
	"STS",
] as const;

export type FieldName = (typeof FIELD_ORDER)[number];

/**
 * VAR 刷新档位
 *
 * - live  实时：TPS / STS，变化最快，采样最密
 * - count 计数：词元类，数字跳太快反而看不清，采样最疏
 * - clock 时钟：随时间连续增长，1 秒一刷才能让秒数肉眼可见地走动
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export type RefreshTier = "live" | "count" | "clock";

/** VAR 字段 → 刷新档位 */
export const FIELD_TIER: Record<FieldName, RefreshTier> = {
	TPS: "live",
	STS: "live",
	AVG_TPS: "count",
	AVG_TTFT: "count",
	TOKEN: "count",
	TOTAL_TK: "count",
	TTFT: "clock",
	DUR: "clock",
	TOTAL_DUR: "clock",
};

/** VAR 各档默认刷新间隔（毫秒） */
export const DEFAULT_REFRESH = {
	/** 实时档：TPS 要跟得上手感 */
	live: 500,
	/** 计数档：1 秒一刷，兼顾跟手与沉稳 */
	count: 1000,
	/** 时钟档：固定 1 秒，让耗时逐秒可见 */
	clock: 1000,
} as const;

export type RefreshConfig = {
	live: number;
	count: number;
	clock: number;
};

/** VAR 默认显示项：全展示，顺序即渲染顺序 */
export const DEFAULT_ITEMS: FieldName[] = [...FIELD_ORDER];

/** VAR STS 默认文案，可通过 options.sts 覆盖任意一项 */
export const DEFAULT_STS_TEXT = {
	/** 会话空闲 */
	idle: "Ready",
	/** 已发出请求但还没有吐字 */
	waiting: "Waiting...",
	/** 正在流式输出 */
	streaming: "Streaming...",
	/** 供应商重试，{n} 会被替换为第几次重试 */
	retrying: "Retrying #{n}...",
	/** 消息出错 */
	error: "Error",
	/** 状态未知 */
	unknown: "-",
};

export type StsText = typeof DEFAULT_STS_TEXT;

/** VAR 单次读数口径：turn=一轮对话聚合，message=最近一条消息 */
export type Scope = "turn" | "message";

export type ResolvedConfig = {
	items: FieldName[];
	separator: string;
	countPrecision: number;
	secondPrecision: number;
	scope: Scope;
	liveEstimate: boolean;
	/** 无数据的字段是否整段隐藏；false 时用 emptyText 占位 */
	hideEmpty: boolean;
	/** hideEmpty=false 时无数据字段显示的占位文本 */
	emptyText: string;
	/** 活动时整行高亮为强调色，静止时回落为弱化色 */
	colorize: boolean;
	refresh: RefreshConfig;
	toastOnComplete: boolean;
	sts: StsText;
};

export const DEFAULT_CONFIG: ResolvedConfig = {
	items: DEFAULT_ITEMS,
	separator: "|",
	countPrecision: 4,
	secondPrecision: 0,
	scope: "turn",
	liveEstimate: true,
	hideEmpty: false,
	emptyText: "0",
	colorize: true,
	refresh: { ...DEFAULT_REFRESH },
	toastOnComplete: false,
	sts: { ...DEFAULT_STS_TEXT },
};

/** VAR 刷新间隔允许范围（毫秒） */
const MIN_REFRESH_MS = 100;
const MAX_REFRESH_MS = 60000;

/** VAR 字段名查表，用于快速校验 */
const FIELD_LOOKUP = new Set<string>(FIELD_ORDER);

function has(value: unknown): boolean {
	return (! (value === undefined)) && (! (value === null));

}

function normalizeItems(raw: unknown): FieldName[] {
	if (! Array.isArray(raw)) return [...DEFAULT_ITEMS];
	// STEP 去重并丢弃未知字段，保持用户给定顺序
	const picked: FieldName[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") continue;
		const name = entry.trim();
		if (! FIELD_LOOKUP.has(name)) continue;
		if (picked.includes(name as FieldName)) continue;
		picked.push(name as FieldName);
	}
	// BRANCH 全部被过滤掉时回落到默认全展示
	if (picked.length === 0) return [...DEFAULT_ITEMS];
	return picked;

}

function normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
	if (! (typeof raw === "number") || ! Number.isFinite(raw)) return fallback;
	if (raw < min) return min;
	if (raw > max) return max;
	return Math.floor(raw);

}

function normalizeSts(raw: unknown): StsText {
	const text: StsText = { ...DEFAULT_STS_TEXT };
	if (! (typeof raw === "object") || raw === null) return text;
	for (const key of Object.keys(DEFAULT_STS_TEXT) as Array<keyof StsText>) {
		const value = (raw as Record<string, unknown>)[key];
		if (typeof value === "string") text[key] = value;
	}
	return text;

}

function normalizeRefresh(source: Record<string, unknown>): RefreshConfig {
	return {
		live: normalizeNumber(source.refreshLiveMs, DEFAULT_REFRESH.live, MIN_REFRESH_MS, MAX_REFRESH_MS),
		count: normalizeNumber(source.refreshCountMs, DEFAULT_REFRESH.count, MIN_REFRESH_MS, MAX_REFRESH_MS),
		clock: normalizeNumber(source.refreshClockMs, DEFAULT_REFRESH.clock, MIN_REFRESH_MS, MAX_REFRESH_MS),
	};

}

/**
 * 把插件 options 归一化成解析后的配置
 *
 * @param {} options tui.json 中 [spec, options] 元组传入的 options
 * @return {} 完整可用的配置
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function resolveConfig(options?: Record<string, unknown>): ResolvedConfig {
	const source = has(options) ? (options as Record<string, unknown>) : {};
	return {
		items: normalizeItems(source.items ?? source.fields),
		separator: typeof source.separator === "string" && source.separator.length > 0 ? source.separator : DEFAULT_CONFIG.separator,
		countPrecision: normalizeNumber(source.countPrecision, DEFAULT_CONFIG.countPrecision, 0, 8),
		secondPrecision: normalizeNumber(source.secondPrecision, DEFAULT_CONFIG.secondPrecision, 0, 4),
		scope: source.scope === "message" ? "message" : "turn",
		liveEstimate: source.liveEstimate === false ? false : true,
		// BRANCH 默认不隐藏：无数据时用占位文本撑住结构，避免整行宽度反复跳变
		hideEmpty: source.hideEmpty === true,
		emptyText: typeof source.emptyText === "string" ? source.emptyText : DEFAULT_CONFIG.emptyText,
		colorize: source.colorize === false ? false : true,
		refresh: normalizeRefresh(source),
		toastOnComplete: source.toastOnComplete === true,
		sts: normalizeSts(source.sts),
	};

}
