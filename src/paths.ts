import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIRECTORY = "x-block-checker";
const BROWSER_NOT_FOUND_MESSAGE =
	"Chrome、Brave、Edge、Chromiumの実行ファイルが見つかりません。設定の browserExecutable で指定してください";

const MACOS_BROWSER_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

const LINUX_BROWSER_CANDIDATES = [
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/brave-browser",
];

function compactPaths(...paths: Array<string | undefined>): string[] {
	return paths.filter((path): path is string => path !== undefined);
}

function windowsBrowserCandidates(): string[] {
	const localAppData = process.env.LOCALAPPDATA;
	const programFiles = process.env.ProgramFiles;
	const programFilesX86 = process.env["ProgramFiles(x86)"];

	return compactPaths(
		programFiles &&
			join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
		programFilesX86 &&
			join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		localAppData &&
			join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
		programFiles &&
			join(
				programFiles,
				"BraveSoftware",
				"Brave-Browser",
				"Application",
				"brave.exe",
			),
		programFilesX86 &&
			join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
	);
}

function browserCandidates(): readonly string[] {
	switch (process.platform) {
		case "win32":
			return windowsBrowserCandidates();
		case "darwin":
			return MACOS_BROWSER_CANDIDATES;
		default:
			return LINUX_BROWSER_CANDIDATES;
	}
}

export function appDataDir(): string {
	let dataRoot: string;
	switch (process.platform) {
		case "win32":
			dataRoot =
				process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
			break;
		case "darwin":
			dataRoot = join(homedir(), "Library", "Application Support");
			break;
		default:
			dataRoot =
				process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
	}
	return join(dataRoot, APP_DIRECTORY);
}

export function findBrowserExecutable(explicitPath?: string): string {
	if (explicitPath) {
		if (!existsSync(explicitPath))
			throw new Error(`ブラウザが見つかりません: ${explicitPath}`);
		return explicitPath;
	}

	const found = browserCandidates().find(existsSync);
	if (!found) throw new Error(BROWSER_NOT_FOUND_MESSAGE);
	return found;
}
