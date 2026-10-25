/**
 * 依赖与入口体检：把守三条踩过坑的硬规则
 * </br>规则一 插件目录不得存在 node_modules/@opentui 或 node_modules/solid-js：
 * 宿主的 Solid 转换插件用负向先行断言排除路径含 node_modules 的文件，那些文件不会被转换；
 * 且第二份 @opentui/core 会与宿主抢注册环境变量 OPENTUI_FORCE_WCWIDTH 直接抛错，插件被静默丢弃
 * </br>规则二 入口文件不得出现来自 "solid-js" 的裸导入：
 * 本插件全程命令式渲染，不需要响应式原语，禁掉是风格约束
 * NOTE 更正（2026-10-15 核实）：宿主 @opentui/solid/runtime-plugin-support/configure.js 的
 * 重写映射表里其实**包含** "solid-js" 与 "solid-js/store"，裸 specifier 会被改写到宿主那
 * 唯一一份实例，**并非**「照常解析并失败」。OpenCode 内置的 MCP / LSP / Todo / Files
 * 四个侧边栏区块自己就 import { createSignal, Show } from "solid-js"。
 * 正则拦截刻意保留，只把描述改准确 —— 去留需要真机验证，不该凭源码推断就动安全闸门。
 * </br>规则三 入口必须是原始 .tsx，不能是预编译产物：
 * 宿主的 Solid 转换插件只跳过路径含 node_modules 的文件；本插件经 junction 加载时
 * 真实路径在 node_modules 之外，压缩过的 .js 会被转换器处理并直接崩掉
 * </br>运行：bun run check-deps
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 仓库根目录 (scripts/ 的上一级) */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CONST 污染要素数组，出现即判定为污染，插件会被 OpenCode 静默丢弃 */
const POISON = [join("node_modules", "@opentui"), join("node_modules", "solid-js")];

/** CONST 入口里不允许出现的裸 specifier；本插件用不到响应式原语，禁掉是风格约束（宿主实际会重写它，详见文件头 NOTE） */
const BARE_SOLID = /from\s+"solid-js(\/[^"]*)?"/;

/** CONST 入口允许的扩展名 */
const ENTRY_SUFFIX = ".tsx";

// ===== ===== ===== ===== [内部方法] ===== ===== ===== =====

/**
 * 剥掉块注释与行注释，只留真正的代码
 * </br>规则二要拦的是代码里的裸导入语句，而注释里把 `from "solid-js"` 当反例引用是
 * 合理的（例如文件头记录「这条规则曾被证伪」），不剥注释就会把说明文字一并拦下
 * @param {string} text 源文件全文
 * @return {string} code 去掉注释后的代码文本
 * @author DeepSeek_V4_Flash
 * @date 2026-10-15
 * @note note
 */
function stripComments(text: string): string {
	// STEP 先整体去掉块注释 (含 JSDoc)，正则容错未闭合的起始标记，避免误吞后续代码
	let stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
	stripped = stripped.replace(/\/\*[^*]*$/g, "");
	
	// STEP 再去掉行注释，只砍掉第一个换行符之前的内容，保留换行以维持行边界
	return stripped.replace(/\/\/[^\n]*/g, "");
	
}

// ===== ===== ===== ===== [逻辑代码] ===== ===== ===== =====

// STEP 扫描污染要素：插件目录里出现本地 @opentui / solid-js 即判失败

let failed = 0;

for (const relative of POISON) {
	if (! existsSync(join(root, relative))) continue;
	failed = failed + 1;
	console.log(`[FAIL ] 存在 ${relative} —— 必须删除，否则插件无法加载`);
	console.log(`       删除命令： rd /s /q "${join(root, relative)}"`);
	
}

// STEP 校验 package.json 的 TUI 入口声明

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entry = manifest.exports?.["./tui"];

if (typeof entry !== "string") {
	// SUBSTEP 声明缺失或不是字符串，直接计失败
	failed = failed + 1;
	console.log('[FAIL ] package.json 的 exports["./tui"] 不是字符串');
	
} else {
	// SUBSTEP 校验入口扩展名必须是原始 .tsx
	if (! entry.endsWith(ENTRY_SUFFIX)) {
		failed = failed + 1;
		console.log(`[FAIL ] 入口是 ${entry}，必须是原始 .tsx (见文件头规则三)`);
		
	} else {
		console.log(`[PASS ] 入口为原始 .tsx：${entry}`);
		
	}
	
	// SUBSTEP 校验入口文件真实存在，并对其内容做两条规则检查
	const entryPath = join(root, entry.replace(/^\.\//, ""));
	if (! existsSync(entryPath)) {
		failed = failed + 1;
		console.log(`[FAIL ] 入口文件不存在：${entry}`);
		
	} else {
		// PART 检查裸 solid-js 导入 (规则二)
		const text = readFileSync(entryPath, "utf8");
		// SUBSTEP 先剥掉块注释与行注释再匹配：规则二要拦的是**代码里的**导入语句，
		// 注释里引用 `from "solid-js"` 作为反例说明是合理的，不该被一并拦下
		if (BARE_SOLID.test(stripComments(text))) {
			failed = failed + 1;
			console.log(`[FAIL ] ${entry} 里出现了裸 "solid-js" 导入，本插件用不到响应式原语，禁掉是风格约束`);
			
		} else {
			console.log(`[PASS ] ${entry} 无裸 solid-js 导入`);
			
		}
		
		// PART 检查文件头 @jsxImportSource 指令 (node_modules 内编译依赖它)
		if (! text.startsWith("/** @jsxImportSource @opentui/solid */")) {
			console.log("[WARN ] 入口文件头缺少 @jsxImportSource 指令，装进 node_modules 后会退化成 React JSX");
			
		} else {
			console.log("[PASS ] 入口文件头带 @jsxImportSource 指令");
			
		}
		
	}
	
}

// STEP 检查 dist/ 目录不存在 (预编译产物会被宿主转换器处理并崩掉)

if (existsSync(join(root, "dist"))) {
	const size = statSync(join(root, "dist")).size;
	failed = failed + 1;
	console.log(`[FAIL ] 存在 dist/ (${size} 字节) —— 它不是入口，且容易被误当成入口，请删除`);
	
} else {
	console.log("[PASS ] 不存在 dist/ 目录");
	
}

// STEP 检查 node_modules 状态 (存在不算失败，但必须提醒它的用途边界)

const modules = join(root, "node_modules");
if (! existsSync(modules)) {
	console.log("[PASS ] 插件目录不存在 node_modules (理想状态)");
	
} else {
	console.log(`[INFO ] node_modules 有 ${readdirSync(modules).length} 项，仅用于编辑器与类型检查，切勿当成运行时依赖`);
	
}

// STEP 汇总失败数并以退出码向调用方报告结果

console.log(`\n共 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
