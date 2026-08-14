import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function appDataDir(): string {
	if (process.platform === "win32")
		return join(
			process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
			"x-block-checker",
		);
	if (process.platform === "darwin")
		return join(homedir(), "Library", "Application Support", "x-block-checker");
	return join(
		process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
		"x-block-checker",
	);
}

export function findBrowserExecutable(explicitPath?: string): string {
	if (explicitPath) {
		if (!existsSync(explicitPath))
			throw new Error(`ブラウザが見つかりません: ${explicitPath}`);
		return explicitPath;
	}
	const local = process.env.LOCALAPPDATA ?? "";
	const programFiles = process.env.ProgramFiles ?? "";
	const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "";
	const candidates =
		process.platform === "win32"
			? [
					join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
					join(
						programFilesX86,
						"Google",
						"Chrome",
						"Application",
						"chrome.exe",
					),
					join(local, "Google", "Chrome", "Application", "chrome.exe"),
					join(
						programFiles,
						"BraveSoftware",
						"Brave-Browser",
						"Application",
						"brave.exe",
					),
					join(
						programFilesX86,
						"Microsoft",
						"Edge",
						"Application",
						"msedge.exe",
					),
				]
			: process.platform === "darwin"
				? [
						"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
						"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
						"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
					]
				: [
						"/usr/bin/google-chrome",
						"/usr/bin/google-chrome-stable",
						"/usr/bin/chromium",
						"/usr/bin/chromium-browser",
						"/usr/bin/brave-browser",
					];
	const found = candidates.find(
		(candidate) => candidate && existsSync(candidate),
	);
	if (!found)
		throw new Error(
			"Chrome、Brave、Edge、Chromiumの実行ファイルが見つかりません。設定の browserExecutable で指定してください",
		);
	return found;
}
