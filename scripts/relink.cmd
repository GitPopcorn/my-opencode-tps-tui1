@ECHO OFF
SetLocal EnableDelayedExpansion
@REM ================================================================
@REM  重建 my-opencode-tps-tui1 的缓存 junction
@REM
@REM  背景
@REM    opencode 把裸包名解析到
@REM      %USERPROFILE%\.cache\opencode\packages\<spec>\node_modules\<name>
@REM    该目录属于缓存，opencode uninstall 会删除它且没有保留开关
@REM    本脚本用 junction 把缓存入口指回插件仓库本体
@REM    于是插件真身可留在任意磁盘，tui.jsonc 里只写包名
@REM
@REM  要点
@REM    junction 必须做在 <spec>\node_modules\<name> 这一层
@REM    做成整个 <spec> 目录无效，opencode 会转去 npm install
@REM
@REM  行为
@REM    已就绪则直接返回，不做任何删除
@REM    仅在链接损坏时才移除旧链接，且不带 /S，不会递归进目标目录
@REM ================================================================

SET "PLUGIN_NAME=my-opencode-tps-tui1"
SET "PLUGIN_SPEC=my-opencode-tps-tui1@latest"
SET "PLUGIN_VERSION=latest"

@REM STEP 帮助参数
IF /I "%~1"=="Help"   GOTO :USAGE
IF /I "%~1"=="-Help"  GOTO :USAGE
IF /I "%~1"=="--Help" GOTO :USAGE
IF /I "%~1"=="-H"     GOTO :USAGE
IF /I "%~1"=="/?"     GOTO :USAGE

@REM STEP 把本脚本所在的上一级目录解析成绝对路径
SET "PLUGIN_DIR=%~dp0.."
FOR %%a IN ("%PLUGIN_DIR%") DO SET "PLUGIN_DIR=%%~fa"

IF NOT EXIST "%PLUGIN_DIR%\package.json" (
	ECHO [错误] 未找到 "%PLUGIN_DIR%\package.json"
	ECHO         本脚本需放在插件仓库的 scripts 子目录下
	EXIT /B 1
)

@REM WARN 本地 @opentui 会与宿主抢注册环境变量，直接导致插件被静默丢弃
IF EXIST "%PLUGIN_DIR%\node_modules\@opentui" (
	ECHO [中止] 检测到 %PLUGIN_DIR%\node_modules\@opentui
	ECHO         它会让 OpenCode 加载插件时抛出环境变量重复注册错误
	ECHO         请先删除该目录再重试，或用 bun run check-deps 复核
	EXIT /B 3
)

@REM STEP 组装缓存侧路径
SET "CACHE_ROOT=%USERPROFILE%\.cache\opencode\packages\%PLUGIN_SPEC%"
SET "CACHE_NM=%CACHE_ROOT%\node_modules"
SET "LINK_PATH=%CACHE_NM%\%PLUGIN_NAME%"
SET "SHELL_PKG=%CACHE_ROOT%\package.json"

@REM STEP 已就绪则直接返回，避免无谓的删除动作
IF EXIST "%LINK_PATH%\package.json" (
	ECHO [就绪] %LINK_PATH%
	ECHO          已指向 %PLUGIN_DIR%
	EXIT /B 0
)

@REM STEP 建目录
IF NOT EXIST "%CACHE_ROOT%" MKDIR "%CACHE_ROOT%"
IF NOT EXIST "%CACHE_NM%" MKDIR "%CACHE_NM%"

@REM STEP 写外壳 package.json
> "%SHELL_PKG%" ECHO {
>>"%SHELL_PKG%" ECHO 	"dependencies": {
>>"%SHELL_PKG%" ECHO 		"%PLUGIN_NAME%": "%PLUGIN_VERSION%"
>>"%SHELL_PKG%" ECHO 	}
>>"%SHELL_PKG%" ECHO }

@REM STEP 清理损坏的旧链接
@REM WARN 此处只用 RMDIR 不带 /S，只移除重解析点，不会递归删除目标目录内容
IF EXIST "%LINK_PATH%\" (
	ECHO [提示] 检测到损坏或过期的旧链接，先移除
	RMDIR "%LINK_PATH%" 2>NUL
)
IF EXIST "%LINK_PATH%\" (
	ECHO [中止] 旧链接无法自动移除，请手工删除该目录后重试
	ECHO        %LINK_PATH%
	EXIT /B 2
)

@REM STEP 创建 JUNCTION
MKLINK /J "%LINK_PATH%" "%PLUGIN_DIR%"
IF ERRORLEVEL 1 (
	ECHO [失败] JUNCTION 目录链接创建失败
	EXIT /B 1
)

@REM STEP 校验
IF NOT EXIST "%LINK_PATH%\package.json" (
	ECHO [失败] 目录链接已建立但穿透校验不通过
	EXIT /B 1
)

ECHO [完成] %LINK_PATH%
ECHO        指向 %PLUGIN_DIR%
ECHO.
ECHO 请确认 %USERPROFILE%\.config\opencode\tui.jsonc 的 plugin 数组里有：
ECHO   "%PLUGIN_SPEC%"
ECHO.
ECHO 重启 opencode 生效
EXIT /B 0

:USAGE
ECHO 重建 my-opencode-tps-tui1 的缓存 JUNCTION
ECHO.
ECHO 用法:
ECHO     relink.cmd                           执行重建
ECHO     relink.cmd [--Help^|-Help^|Help^|-H^|/?] 显示本帮助
ECHO.
ECHO 何时需要:
ECHO     执行过 opencode uninstall
ECHO     手动清理过 %USERPROFILE%\.cache\opencode
ECHO     插件仓库换了路径或改了名
ECHO.
ECHO 说明:
ECHO     opencode 解析裸包名时，若 <spec>\node_modules\<name> 已存在
ECHO     就直接复用、不访问 npm registry
ECHO     本脚本就是把这个入口重新指回插件仓库本体
ECHO.
ECHO     已就绪时脚本直接返回，不做任何删除
ECHO     仅在链接损坏时才用不带 /S 的 RMDIR 移除旧链接
EXIT /B 0
