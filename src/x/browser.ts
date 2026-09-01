import { spawn } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { appDataDir } from "../config/paths";
import { hasErrorCode } from "../errors";
import type { CheckResult, DoctorResult, RuntimeConfig } from "../types";
import { createXChecker } from "./checker";

interface LaunchedBrowser {
	browser: Browser;
	page: Page;
}

export function ignoredDefaultBrowserArgs(
	platform: NodeJS.Platform = process.platform,
): string[] | undefined {
	if (platform !== "darwin") return undefined;
	return ["--use-mock-keychain"];
}

type ProgressCallback = (
	index: number,
	total: number,
	result: CheckResult,
) => void;

function isWithinPath(path: string, parent: string): boolean {
	const child = relative(resolve(parent), resolve(path));
	return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function regularBrowserProfileRoots(): string[] {
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA;
		if (!local) return [];
		return [
			join(local, "Google", "Chrome", "User Data"),
			join(local, "BraveSoftware", "Brave-Browser", "User Data"),
			join(local, "Microsoft", "Edge", "User Data"),
		];
	}
	if (process.platform === "darwin")
		return [
			join(homedir(), "Library", "Application Support", "Google", "Chrome"),
			join(homedir(), "Library", "Application Support", "Chromium"),
			join(
				homedir(),
				"Library",
				"Application Support",
				"BraveSoftware",
				"Brave-Browser",
			),
			join(homedir(), "Library", "Application Support", "Microsoft Edge"),
		];
	return [
		join(homedir(), ".config", "google-chrome"),
		join(homedir(), ".config", "chromium"),
		join(homedir(), ".config", "BraveSoftware", "Brave-Browser"),
		join(homedir(), ".config", "microsoft-edge"),
	];
}

async function ensureDedicatedProfile(profileDir: string): Promise<void> {
	if (
		regularBrowserProfileRoots().some((root) => isWithinPath(profileDir, root))
	)
		throw new Error(
			"普段使いのブラウザプロファイルは使用できません。x-block-checker専用の空ディレクトリを指定してください",
		);

	await mkdir(profileDir, { recursive: true });
	const markerPath = join(profileDir, ".x-block-checker-profile");
	try {
		await access(markerPath);
		return;
	} catch (error) {
		if (!hasErrorCode(error, "ENOENT")) throw error;
	}

	const isDefaultProfile =
		resolve(profileDir) === resolve(appDataDir(), "profile");
	if (!isDefaultProfile && (await readdir(profileDir)).length > 0)
		throw new Error(
			`専用profileのmarkerがありません: ${profileDir}。空ディレクトリを指定してください`,
		);
	try {
		await writeFile(markerPath, '{"version":1}\n', { flag: "wx" });
	} catch (error) {
		if (!hasErrorCode(error, "EEXIST")) throw error;
	}
}

async function launchBrowser(
	config: RuntimeConfig,
	headless: boolean,
): Promise<LaunchedBrowser> {
	await ensureDedicatedProfile(config.profileDir);
	const ignoreDefaultArgs = ignoredDefaultBrowserArgs();
	const browser = await puppeteer.launch({
		executablePath: config.browserExecutable,
		userDataDir: config.profileDir,
		headless,
		...(ignoreDefaultArgs ? { ignoreDefaultArgs } : {}),
		args: ["--no-first-run", "--no-default-browser-check"],
	});
	const pages = await browser.pages();
	return { browser, page: pages[0] ?? (await browser.newPage()) };
}

async function hasAuthCookie(browser: Browser): Promise<boolean> {
	const cookies = await browser.defaultBrowserContext().cookies();
	return cookies.some(
		(cookie) => cookie.name === "auth_token" && cookie.value.length > 0,
	);
}

export async function diagnose(config: RuntimeConfig): Promise<DoctorResult> {
	const { browser } = await launchBrowser(config, true);
	try {
		const authenticated = await hasAuthCookie(browser);
		return {
			ready: authenticated,
			authenticated,
			configuredUsers: config.users.length,
			browserExecutable: config.browserExecutable,
			profileDir: config.profileDir,
			message: authenticated
				? "Xブロック確認を実行できます"
				: "Xへ未認証です。先に x-block-checker auth を実行してください",
		};
	} finally {
		await browser.close();
	}
}

export async function authenticate(config: RuntimeConfig): Promise<void> {
	await ensureDedicatedProfile(config.profileDir);
	const closeInstruction =
		process.platform === "darwin"
			? "ログイン完了後、Command+Qでブラウザを完全に終了してください"
			: "ログイン完了後、ブラウザを閉じてください";
	process.stderr.write(
		`専用ブラウザでXへログインしてください。${closeInstruction}\n`,
	);
	const browserProcess = spawn(
		config.browserExecutable,
		[`--user-data-dir=${config.profileDir}`, "https://x.com/login"],
		{ stdio: "ignore" },
	);
	const exitCode = await new Promise<number | null>((resolve, reject) => {
		browserProcess.once("error", reject);
		browserProcess.once("exit", resolve);
	});
	if (exitCode !== 0)
		throw new Error(
			`認証用ブラウザが異常終了しました: ${exitCode ?? "signal"}`,
		);

	const { browser } = await launchBrowser(config, true);
	try {
		if (!(await hasAuthCookie(browser)))
			throw new Error(
				"Xへのログインを確認できませんでした。authを再実行してください",
			);
	} finally {
		await browser.close();
	}
}

export async function checkUsers(
	config: RuntimeConfig,
	onProgress?: ProgressCallback,
): Promise<CheckResult[]> {
	const { browser, page } = await launchBrowser(config, config.headless);
	try {
		if (!(await hasAuthCookie(browser)))
			throw new Error(
				"Xへ未認証です。先に x-block-checker auth を実行してください",
			);
		const checkUser = createXChecker(page, config.relationshipMode);
		const results: CheckResult[] = [];
		for (const [index, username] of config.users.entries()) {
			const result = await checkUser(username, config.timeoutMs);
			results.push(result);
			onProgress?.(index + 1, config.users.length, result);
		}
		return results;
	} finally {
		await browser.close();
	}
}
