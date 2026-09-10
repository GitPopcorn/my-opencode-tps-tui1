/**
 * 数值与时长格式化
 *
 * 计数（TOKEN / TOTAL_TK）：小于 1000 直接给整数；超过则按 k / m / b 缩写，
 * 最多保留 4 位小数并去掉尾随零。
 *
 * 时长（TTFT / AVG_TTFT / CST / TOTAL_CST）：ms、s、m+s、h+m+s 四种模式，
 * 仅 s 模式带小数（默认 2 位），其余模式一律整数。
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

/** VAR 计数缩写单位，1000 进制递进 */
const COUNT_UNITS = ["", "k", "m", "b"] as const;

/** VAR 无数据占位符 */
export const EMPTY = "-";

/**
 * 格式化词元计数
 *
 * @param {} value 原始计数
 * @param {} maxDecimals 缩写后最多保留的小数位
 * @return {} 格式化文本，无数据返回占位符
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function formatCount(value: number | undefined, maxDecimals: number = 4): string {
	if (! (typeof value === "number") || ! Number.isFinite(value) || value < 0) return EMPTY;
	if (value < 1000) return String(Math.round(value));
	// STEP 逐级缩小到 1000 以下，同时记录量级
	let scaled = value;
	let unit = 0;
	while (scaled >= 1000 && unit < COUNT_UNITS.length - 1) {
		scaled = scaled / 1000;
		unit = unit + 1;
	}
	// STEP 定点截断后去掉尾随零与孤立小数点
	let text = scaled.toFixed(maxDecimals);
	if (text.includes(".")) {
		text = text.replace(/0+$/, "");
		text = text.replace(/\.$/, "");
	}
	return text + COUNT_UNITS[unit];

}

/**
 * 格式化时长
 *
 * @param {} ms 毫秒数
 * @param {} secondPrecision s 模式保留的小数位；0 时取整秒
 * @return {} 格式化文本，无数据返回占位符
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function formatDuration(ms: number | undefined, secondPrecision: number = 2): string {
	if (! (typeof ms === "number") || ! Number.isFinite(ms) || ms < 0) return EMPTY;
	// BRANCH 毫秒模式（无小数点，不受精度影响）
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const totalSeconds = ms / 1000;
	// BRANCH 秒模式，唯一允许小数的模式；精度为 0 时直接取整秒
	if (totalSeconds < 60) return secondPrecision > 0 ? `${totalSeconds.toFixed(secondPrecision)}s` : `${Math.round(totalSeconds)}s`;
	// STEP 秒以上一律取整后再拆分
	const whole = Math.round(totalSeconds);
	const hours = Math.floor(whole / 3600);
	const minutes = Math.floor((whole % 3600) / 60);
	const seconds = whole % 60;
	// BRANCH 小时模式
	if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
	return `${minutes}m${seconds}s`;

}

/**
 * 格式化速率（词元/秒）
 *
 * 沿用 opencode-tps1 的分档：>=100 取整、>=10 一位小数、其余两位小数。
 *
 * @param {} value 速率
 * @return {} 格式化文本，无数据返回占位符
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function formatRate(value: number | undefined): string {
	if (! (typeof value === "number") || ! Number.isFinite(value) || value <= 0) return EMPTY;
	if (value >= 100) return String(Math.round(value));
	if (value >= 10) return value.toFixed(1);
	return value.toFixed(2);

}
