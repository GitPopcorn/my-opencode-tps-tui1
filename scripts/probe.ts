/**
 * 自诊断探针生成器
 *
 * TUI 插件的加载失败不留任何痕迹（不进日志、不进 stderr），所以要点亮一个
 * 首页可见的槽位来观察。本脚本把 tui.tsx 与 src/ 复制到临时目录，
 * 把槽位名 session_prompt_right 换成 app_bottom，并写好项目级 tui.json。
 *
 * 运行：bun run scripts/probe.ts
 * 然后：cd 到脚本打印的目录，执行 opencode，看首页底部有没有出现状态行
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "tui.tsx");

if (! existsSync(source)) {
	console.error("缺少 tui.tsx");
	process.exit(1);
}

const work = resolve(process.env.TEMP ?? "/tmp", "oc-tps-probe");
const pkg = join(work, "probe-pkg");
const entry = join(pkg, "tui.tsx");

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, ".opencode"), { recursive: true });
cpSync(join(root, "src"), join(pkg, "src"), { recursive: true });

// STEP 槽位换成首页可见的 app_bottom，这样无会话时也能看到渲染结果
const original = readFileSync(source, "utf8");
const swapped = original.split("session_prompt_right").join("app_bottom");
writeFileSync(entry, swapped);
console.log(`槽位名替换次数 = ${original.split("session_prompt_right").length - 1}`);

writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "oc-tps-probe", version: "0.1.0", type: "module", exports: { ".": "./tui.tsx", "./tui": "./tui.tsx" } }, null, "\t")}\n`);

// STEP 项目级配置：用 file:// 直指探针入口，同时也把裸包名形态列出来备用
const config = {
	plugin: [[pathToFileURL(entry).href, { hideEmpty: false }]],
};
writeFileSync(join(work, ".opencode", "tui.json"), `${JSON.stringify(config, null, "\t")}\n`);

console.log("");
console.log("探针已就绪");
console.log(`  目录： ${work}`);
console.log(`  入口： ${pathToFileURL(entry).href}`);
console.log("  槽位： app_bottom（首页底部可见）");
console.log("");
console.log("下一步：");
console.log(`  cd /d "${work}"`);
console.log("  opencode");
console.log("");
console.log("预期：首页底部出现 TPS - | AVG_TPS - | TOKEN - | ... 即说明插件本体与注册链路正常");
console.log("      什么都没有 = 加载失败（此时把 tui.tsx 的槽位改回 session_prompt_right 供正式使用）");
