/**
 * 插件配置解析
 * </br>所有显示项由 items 数组汇总：既决定显示哪些字段，也决定显示顺序。
 * 解析时会去重、丢弃未知字段，并在结果为空时回落到默认全展示。
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

// ===== ===== ===== ===== [常量与类型] ===== ===== ===== =====

/** CONST 支持的显示字段，顺序即默认渲染顺序 */
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

/** VAR 显示字段名联合类型，由 FIELD_ORDER 逐项推导 */
export type FieldName = (typeof FIELD_ORDER)[number];

/**
 * VAR 刷新档位
 * <ul>
 *     <li>live  实时：TPS / STS，变化最快，采样最密</li>
 *     <li>count 计数：词元类，数字跳太快反而看不清，采样最疏</li>
 *     <li>clock 时钟：随时间连续增长，1 秒一刷才能让秒数肉眼可见地走动</li>
 * </ul>
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export type RefreshTier = "live" | "count" | "clock";

/** CONST 字段 → 刷新档位查表 */
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

/** CONST 各档默认刷新间隔 (毫秒) */
export const DEFAULT_REFRESH = {
	/** 实时档：TPS 要跟得上手感 */
	live: 500,
	/** 计数档：1 秒一刷，兼顾跟手与沉稳 */
	count: 1000,
	/** 时钟档：固定 1 秒，让耗时逐秒可见 */
	clock: 1000,
} as const;

/** VAR 三档刷新间隔的解析结果类型 */
export type RefreshConfig = {
	live: number;
	count: number;
	clock: number;
};

/** CONST 默认显示项：全展示，顺序即渲染顺序 */
export const DEFAULT_ITEMS: FieldName[] = [...FIELD_ORDER];

/** CONST STS 默认文案，可通过 options.sts 覆盖任意一项 */
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

/** VAR STS 文案表类型，由 DEFAULT_STS_TEXT 推导 */
export type StsText = typeof DEFAULT_STS_TEXT;

/** VAR 字段显示名表类型：键为字段名，值为渲染时的前缀文本 */
export type LabelMap = Record<FieldName, string>;

/** CONST 字段显示名默认表：默认显示字段自身的大写下划线名，可通过 options.labels 逐项覆盖 */
export const DEFAULT_LABELS: LabelMap = {
	TPS: "TPS",
	AVG_TPS: "AVG_TPS",
	TOKEN: "TOKEN",
	TOTAL_TK: "TOTAL_TK",
	TTFT: "TTFT",
	AVG_TTFT: "AVG_TTFT",
	DUR: "DUR",
	TOTAL_DUR: "TOTAL_DUR",
	STS: "STS",
};

/** VAR 单次读数口径：turn=一轮对话聚合，message=最近一条消息 */
export type Scope = "turn" | "message";

/** VAR 解析后的完整配置类型 */
export type ResolvedConfig = {
	items: FieldName[];
	/** VAR 字段显示名表：渲染时作为各字段的前缀文本，可自定义成任意字符串 / 符号 / Emoji */
	labels: LabelMap;
	separator: string;
	countPrecision: number;
	secondPrecision: number;
	scope: Scope;
	liveEstimate: boolean;
	/** VAR 无数据的字段是否整段隐藏；false 时用 emptyText 占位 */
	hideEmpty: boolean;
	/** VAR hideEmpty=false 时无数据字段显示的占位文本 */
	emptyText: string;
	/** VAR 活动时整行高亮为强调色，静止时回落为弱化色 */
	colorize: boolean;
	refresh: RefreshConfig;
	toastOnComplete: boolean;
	sts: StsText;
};

/** CONST 全量默认配置，所有可选项的兜底值 */
export const DEFAULT_CONFIG: ResolvedConfig = {
	items: DEFAULT_ITEMS,
	labels: { ...DEFAULT_LABELS },
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

/** CONST 刷新间隔允许下限 (毫秒)，防止过密采样拖垮渲染 */
const MIN_REFRESH_MS = 100;

/** CONST 刷新间隔允许上限 (毫秒)，防止配置出天文数字导致读数永不更新 */
const MAX_REFRESH_MS = 60000;

/** CONST 字段名查表，用于快速校验 */
const FIELD_LOOKUP = new Set<string>(FIELD_ORDER);

// ===== ===== ===== ===== [内部方法] ===== ===== ===== =====

/**
 * 判定值是否非 undefined 且非 null
 * @param {unknown} value 待判定值
 * @return {boolean} has true 表示有值
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function has(value: unknown): boolean {
	return (! (value === undefined)) && (! (value === null));

}

/**
 * 归一化显示项数组：去重、丢弃未知字段、空结果回落全展示
 * @param {unknown} raw 用户传入的 items/fields 原始值
 * @return {FieldName[]} items 归一化后的字段数组
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function normalizeItems(raw: unknown): FieldName[] {
	// BRANCH 非数组直接回落默认全展示
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

/**
 * 归一化数字配置：类型校验、上下限钳制、向下取整
 * @param {unknown} raw 原始值
 * @param {number} fallback 非法时的回落值
 * @param {number} min 允许下限
 * @param {number} max 允许上限
 * @return {number} num 归一化后的数字
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
	// STEP 非法类型回落默认值
	if (! (typeof raw === "number") || ! Number.isFinite(raw)) return fallback;

	// STEP 上下限钳制
	if (raw < min) return min;
	if (raw > max) return max;

	// STEP 向下取整后返回
	return Math.floor(raw);

}

/**
 * 归一化 STS 文案表：逐项接受字符串覆盖，非法项保留默认
 * @param {unknown} raw 用户传入的 sts 原始值
 * @return {StsText} text 完整文案表
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function normalizeSts(raw: unknown): StsText {
	// STEP 以默认文案表为底本
	const text: StsText = { ...DEFAULT_STS_TEXT };

	// BRANCH 非对象直接返回默认表
	if (! (typeof raw === "object") || raw === null) return text;

	// STEP 逐项拷贝合法的字符串覆盖值
	for (const key of Object.keys(DEFAULT_STS_TEXT) as Array<keyof StsText>) {
		const value = (raw as Record<string, unknown>)[key];
		if (typeof value === "string") text[key] = value;
	}

	// STEP 返回合并结果
	return text;

}

/**
 * 归一化字段显示名表：逐项接受非空字符串覆盖，未知键、空串与非字符串回落默认
 * @param {unknown} raw 用户传入的 labels 原始值
 * @return {LabelMap} labels 完整显示名表
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function normalizeLabels(raw: unknown): LabelMap {
	// STEP 以默认显示名表为底本
	const labels: LabelMap = { ...DEFAULT_LABELS };

	// BRANCH 非对象直接返回默认表
	if (! (typeof raw === "object") || raw === null) return labels;

	// STEP 只遍历已知字段名，未提及的键天然忽略
	for (const key of FIELD_ORDER) {
		const value = (raw as Record<string, unknown>)[key];
		if (typeof value === "string" && value.length > 0) labels[key] = value;
	}

	// STEP 返回合并结果
	return labels;

}

/**
 * 归一化三档刷新间隔：从平铺的 refreshXxxMs 选项读取并钳制
 * @param {Record<string, unknown>} source 插件 options 对象
 * @return {RefreshConfig} refresh 三档间隔
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function normalizeRefresh(source: Record<string, unknown>): RefreshConfig {
	return {
		live: normalizeNumber(source.refreshLiveMs, DEFAULT_REFRESH.live, MIN_REFRESH_MS, MAX_REFRESH_MS),
		count: normalizeNumber(source.refreshCountMs, DEFAULT_REFRESH.count, MIN_REFRESH_MS, MAX_REFRESH_MS),
		clock: normalizeNumber(source.refreshClockMs, DEFAULT_REFRESH.clock, MIN_REFRESH_MS, MAX_REFRESH_MS),
	};

}

// ===== ===== ===== ===== [导出方法] ===== ===== ===== =====

/**
 * 把插件 options 归一化成解析后的配置
 * @param {Record<string, unknown> | undefined} options tui.json 中 [spec, options] 元组传入的 options
 * @return {ResolvedConfig} config 完整可用的配置
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function resolveConfig(options?: Record<string, unknown>): ResolvedConfig {
	// STEP options 缺省时按空对象处理
	const source = has(options) ? (options as Record<string, unknown>) : {};

	// STEP 逐项归一化：合法值采纳，非法值回落默认
	return {
		items: normalizeItems(source.items ?? source.fields),
		labels: normalizeLabels(source.labels),
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
