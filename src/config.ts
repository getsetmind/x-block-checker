import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { CliOptions } from "./args.js";
import { appDataDir, findBrowserExecutable } from "./paths.js";
import type { ConfigFile, RuntimeConfig } from "./types.js";
import { type RelationshipMode, relationshipModes } from "./types.js";
import { parseUsernames } from "./usernames.js";

async function readOptionalJson(path: string): Promise<ConfigFile> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as ConfigFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`設定ファイルを読み込めません: ${path}`, { cause: error });
	}
}

function resolveFrom(base: string, path: string): string {
	return isAbsolute(path) ? path : resolve(base, path);
}

function resolveTimeoutSeconds(options: CliOptions, file: ConfigFile): number {
	const seconds = options.timeoutSeconds ?? file.timeoutSeconds ?? 20;
	if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120)
		throw new Error("timeoutSeconds は5〜120で指定してください");
	return seconds;
}

function resolveRelationshipMode(
	options: CliOptions,
	file: ConfigFile,
): RelationshipMode {
	const mode = options.relationshipMode ?? file.relationshipMode ?? "auto";
	if (relationshipModes.includes(mode)) return mode;
	throw new Error(
		"relationshipMode は auto、dom、passive、direct のいずれかで指定してください",
	);
}

async function resolveUsernames(
	options: CliOptions,
	file: ConfigFile,
	base: string,
): Promise<string[]> {
	const values = [...(file.users ?? []), ...options.usernames];
	const inputPath = options.inputPath ?? file.input;
	if (inputPath)
		values.push(await readFile(resolveFrom(base, inputPath), "utf8"));
	return parseUsernames(values);
}

export async function resolveConfig(
	options: CliOptions,
): Promise<RuntimeConfig> {
	const configPath = resolve(options.configPath);
	const base = dirname(configPath);
	const file = await readOptionalJson(configPath);
	const timeoutSeconds = resolveTimeoutSeconds(options, file);
	const dataRoot = appDataDir();
	const outputDir = options.outputDir ?? file.outputDir ?? dataRoot;
	const profileDir =
		options.profileDir ?? file.profileDir ?? resolve(dataRoot, "profile");

	return {
		users: await resolveUsernames(options, file, base),
		outputDir: resolveFrom(base, outputDir),
		profileDir: resolveFrom(base, profileDir),
		browserExecutable: findBrowserExecutable(
			options.browserExecutable ?? file.browserExecutable,
		),
		timeoutMs: timeoutSeconds * 1000,
		headless: options.headless ?? file.headless ?? true,
		relationshipMode: resolveRelationshipMode(options, file),
	};
}
