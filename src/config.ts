import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { CliOptions } from "./args.js";
import { appDataDir, findBrowserExecutable } from "./paths.js";
import type { ConfigFile, RuntimeConfig } from "./types.js";
import { parseUsernames } from "./usernames.js";

async function readOptionalJson(path: string): Promise<ConfigFile> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as ConfigFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`設定ファイルを読み込めません: ${path}`, { cause: error });
	}
}

function fromBase(base: string, path: string): string {
	return isAbsolute(path) ? path : resolve(base, path);
}

export async function resolveConfig(
	options: CliOptions,
): Promise<RuntimeConfig> {
	const configPath = resolve(options.configPath);
	const base = dirname(configPath);
	const file = await readOptionalJson(configPath);
	const inputPath = options.inputPath ?? file.input;
	const values = [...(file.users ?? []), ...options.usernames];
	if (inputPath) values.push(await readFile(fromBase(base, inputPath), "utf8"));
	const timeoutSeconds = options.timeoutSeconds ?? file.timeoutSeconds ?? 20;
	if (
		!Number.isFinite(timeoutSeconds) ||
		timeoutSeconds < 5 ||
		timeoutSeconds > 120
	)
		throw new Error("timeoutSeconds は5〜120で指定してください");
	const dataRoot = appDataDir();
	return {
		users: parseUsernames(values),
		outputDir: fromBase(base, options.outputDir ?? file.outputDir ?? dataRoot),
		profileDir: fromBase(
			base,
			options.profileDir ?? file.profileDir ?? resolve(dataRoot, "profile"),
		),
		browserExecutable: findBrowserExecutable(
			options.browserExecutable ?? file.browserExecutable,
		),
		timeoutMs: timeoutSeconds * 1000,
		headless: options.headless ?? file.headless ?? true,
	};
}
