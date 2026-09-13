import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

function compactPaths(...paths: Array<string | undefined>): string[] {
	return paths.filter((path): path is string => path !== undefined);
}

function windowsBrowserCandidates(environment: NodeJS.ProcessEnv): string[] {
	const localAppData = environment.LOCALAPPDATA;
	const programFiles = environment.ProgramFiles;
	const programFilesX86 = environment["ProgramFiles(x86)"];

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

function macBrowserCandidates(home: string): string[] {
	const applications = ["/Applications", posix.join(home, "Applications")];
	const browsers = [
		["Google Chrome.app", "Google Chrome"],
		["Brave Browser.app", "Brave Browser"],
		["Microsoft Edge.app", "Microsoft Edge"],
		["Chromium.app", "Chromium"],
	] as const;
	return applications.flatMap((directory) =>
		browsers.map(([bundle, executable]) =>
			posix.join(directory, bundle, "Contents", "MacOS", executable),
		),
	);
}

/**
 * OSごとにChromium系ブラウザの候補パスを返す
 *
 * @param platform - 判定するOS
 * @param home - ホームディレクトリ
 * @param environment - 参照する環境変数
 */
export function browserExecutableCandidates(
	platform: NodeJS.Platform = process.platform,
	home: string = homedir(),
	environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
	switch (platform) {
		case "win32":
			return windowsBrowserCandidates(environment);
		case "darwin":
			return macBrowserCandidates(home);
		default:
			return [
				"/usr/bin/google-chrome",
				"/usr/bin/google-chrome-stable",
				"/usr/bin/chromium",
				"/usr/bin/chromium-browser",
				"/usr/bin/brave-browser",
			];
	}
}

/**
 * OSごとのユーザーデータ領域にあるアプリ専用ディレクトリを返す
 */
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
	return join(dataRoot, "x-block-checker");
}

/**
 * 指定または自動検出したブラウザの実行ファイルを返す
 *
 * @param explicitPath - 明示された実行ファイル
 */
export function findBrowserExecutable(explicitPath?: string): string {
	if (explicitPath) {
		if (!existsSync(explicitPath))
			throw new Error(`ブラウザが見つかりません: ${explicitPath}`);
		return explicitPath;
	}

	const found = browserExecutableCandidates().find(existsSync);
	if (!found)
		throw new Error(
			"Chrome、Brave、Edge、Chromiumの実行ファイルが見つかりません。設定の browserExecutable で指定してください",
		);
	return found;
}
