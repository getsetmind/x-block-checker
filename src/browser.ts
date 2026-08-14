import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { appDataDir } from "./paths";
import type { CheckResult, RuntimeConfig } from "./types";
import { XChecker } from "./x-checker";

interface LaunchedBrowser {
	browser: Browser;
	page: Page;
}

type ProgressCallback = (
	index: number,
	total: number,
	result: CheckResult,
) => void;

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (error as NodeJS.ErrnoException).code === code;
}

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
	const browser = await puppeteer.launch({
		executablePath: config.browserExecutable,
		userDataDir: config.profileDir,
		headless,
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

export async function authenticate(config: RuntimeConfig): Promise<void> {
	const { browser, page } = await launchBrowser(config, false);
	try {
		await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
		if (await hasAuthCookie(browser)) return;
		process.stderr.write(
			"ブラウザでXへログインしてください。認証完了を最大10分待機します\n",
		);
		const deadline = Date.now() + 10 * 60_000;
		while (Date.now() < deadline) {
			await delay(1_000);
			if (await hasAuthCookie(browser)) return;
		}
		throw new Error("ログイン待機がタイムアウトしました");
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
		const checker = new XChecker(page, config.relationshipMode);
		const results: CheckResult[] = [];
		for (const [index, username] of config.users.entries()) {
			const result = await checker.check(username, config.timeoutMs);
			results.push(result);
			onProgress?.(index + 1, config.users.length, result);
		}
		return results;
	} finally {
		await browser.close();
	}
}
