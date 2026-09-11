/**
 * 数值与时长格式化
 * </br>计数 (TOKEN / TOTAL_TK)：小于 1000 直接给整数；超过则按 k / m / b 缩写，
 * 最多保留 4 位小数并去掉尾随零。
 * </br>时长 (TTFT / AVG_TTFT / DUR / TOTAL_DUR)：ms、s、m+s、h+m+s 四种模式，
 * 仅 s 模式带小数 (默认 2 位)，其余模式一律整数。
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 计数缩写单位，1000 进制递进 */
const COUNT_UNITS = ["", "k", "m", "b"] as const;

/** CONST 无数据占位符 */
export const EMPTY = "-";

// ===== ===== ===== ===== [导出方法] ===== ===== ===== =====

/**
 * 格式化词元计数
 * @param {number | undefined} value 原始计数
 * @param {number} maxDecimals 缩写后最多保留的小数位，默认 4
 * @return {string} text 格式化文本，无数据返回占位符
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function formatCount(value: number | undefined, maxDecimals: number = 4): string {
	// STEP 入数校验：非法值或负数返回占位符
	if (! (typeof value === "number") || ! Number.isFinite(value) || value < 0) return EMPTY;

	// BRANCH 千以内直接给整数，无需缩写
	if (value < 1000) return String(Math.round(value));

	// STEP 逐级缩小到 1000 以下，同时记录量级
	let scaled = value;
	let unit = 0;
	while (scaled >= 1000 && unit < COUNT_UNITS.length - 1) {
		scaled = scaled / 1000;
		unit = unit + 1;
	}

	// SUBSTEP 定点截断后去掉尾随零与孤立小数点

	// PART 以指定精度做定点格式化
	let text = scaled.toFixed(maxDecimals);

	// PART 去掉尾随零与孤立小数点
	if (text.includes(".")) {
		text = text.replace(/0+$/, "");
		text = text.replace(/\.$/, "");
	}

	// STEP 拼接量级单位并返回
	return text + COUNT_UNITS[unit];

}

/**
 * 格式化时长
 * @param {number | undefined} ms 毫秒数
 * @param {number} secondPrecision s 模式保留的小数位；0 时取整秒，默认 2
 * @return {string} text 格式化文本，无数据返回占位符
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function formatDuration(ms: number | undefined, secondPrecision: number = 2): string {
	// STEP 入数校验：非法值或负数返回占位符
	if (! (typeof ms === "number") || ! Number.isFinite(ms) || ms < 0) return EMPTY;

	// BRANCH 毫秒模式 (无小数点，不受精度影响)
	if (ms < 1000) return `${Math.round(ms)}ms`;

	// SUBSTEP 换算总秒数供后续模式判定
	const totalSeconds = ms / 1000;

	// BRANCH 秒模式，唯一允许小数的模式；精度为 0 时直接取整秒
	if (totalSeconds < 60) return secondPrecision > 0 ? `${totalSeconds.toFixed(secondPrecision)}s` : `${Math.round(totalSeconds)}s`;

	// STEP 秒以上一律取整后再拆分
	const whole = Math.round(totalSeconds);
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const seconds = whole % 60;

	// BRANCH 小时模式拼 h+m+s，否则拼 m+s
	if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
	return `${minutes}m${seconds}s`;

}

/**
 * 格式化速率 (词元/秒)
 * </br>沿用 opencode-tps1 的分档：>=100 取整、>=10 一位小数、其余两位小数
 * @param {number | undefined} value 速率
 * @return {string} text 格式化文本，无数据返回占位符
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function formatRate(value: number | undefined): string {
	// STEP 入数校验：非法值或非正数返回占位符
	if (! (typeof value === "number") || ! Number.isFinite(value) || value <= 0) return EMPTY;

	// STEP 按数量级分档取小数位
	if (value >= 100) return String(Math.round(value));
	if (value >= 10) return value.toFixed(1);
	return value.toFixed(2);

}
