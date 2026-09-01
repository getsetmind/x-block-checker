import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { hasErrorCode } from "../errors";
import type { ConfigFile, RuntimeConfig } from "../types";
import { type RelationshipMode, relationshipModes } from "../types";
import type { CliOptions } from "./args";
import { appDataDir, findBrowserExecutable } from "./paths";
import { parseUsernames } from "./usernames";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isRelationshipMode(value: unknown): value is RelationshipMode {
	return relationshipModes.some((mode) => mode === value);
}

function isConfigFile(value: unknown): value is ConfigFile {
	if (!isRecord(value)) return false;
	if ("users" in value && !isStringArray(value.users)) return false;
	if ("input" in value && typeof value.input !== "string") return false;
	if ("outputDir" in value && typeof value.outputDir !== "string") return false;
	if ("profileDir" in value && typeof value.profileDir !== "string")
		return false;
	if (
		"browserExecutable" in value &&
		typeof value.browserExecutable !== "string"
	)
		return false;
	if ("timeoutSeconds" in value && typeof value.timeoutSeconds !== "number")
		return false;
	if ("headless" in value && typeof value.headless !== "boolean") return false;
	if (
		"relationshipMode" in value &&
		!isRelationshipMode(value.relationshipMode)
	)
		return false;
	return true;
}

async function readOptionalJson(path: string): Promise<ConfigFile> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isConfigFile(value)) throw new Error("設定ファイルの形式が不正です");
		return value;
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return {};
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
