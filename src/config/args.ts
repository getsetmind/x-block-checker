import { type RelationshipMode, relationshipModes } from "../types";

/**
 * CLIサブコマンド
 */
export type Command =
	| "auth"
	| "check"
	| "blocking"
	| "doctor"
	| "init"
	| "help";

/**
 * 解析済みのCLI引数
 */
export interface CliOptions {
	command: Command;
	configPath: string;
	usernames: string[];
	inputPath?: string;
	outputDir?: string;
	profileDir?: string;
	browserExecutable?: string;
	timeoutSeconds?: number;
	headless?: boolean;
	relationshipMode?: RelationshipMode;
	json: boolean;
	wait?: boolean;
	restart?: boolean;
	pageLimit?: number;
}

function isCommand(value: string | undefined): value is Command {
	return ["auth", "check", "blocking", "doctor", "init", "help"].includes(
		value ?? "",
	);
}

function requireValue(
	argv: readonly string[],
	index: number,
	option: string,
): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${option} の値を指定してください`);
	}
	return value;
}

function parseTimeout(value: string): number {
	const seconds = Number(value);
	if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120) {
		throw new Error("--timeout は5〜120秒で指定してください");
	}
	return seconds;
}

function parsePageLimit(value: string): number {
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
		throw new Error("--page-limit は1〜100の整数で指定してください");
	}
	return limit;
}

function parseRelationshipMode(value: string): RelationshipMode {
	if (relationshipModes.includes(value as RelationshipMode)) {
		return value as RelationshipMode;
	}
	throw new Error(
		"--relationship-mode は auto、dom、passive、direct のいずれかで指定してください",
	);
}

function validateBlockingOptions(options: CliOptions): void {
	if (
		options.command === "blocking" &&
		(options.usernames.length > 0 || options.inputPath !== undefined)
	) {
		throw new Error("blocking はユーザー引数と --input を指定できません");
	}
	if (
		options.command !== "blocking" &&
		options.command !== "help" &&
		(options.wait !== undefined ||
			options.restart !== undefined ||
			options.pageLimit !== undefined)
	) {
		throw new Error("--wait、--restart、--page-limit はblocking専用です");
	}
}

/**
 * コマンドライン引数を解析してオプションへ変換する
 *
 * @param argv - コマンド名より後ろの引数一覧
 */
export function parseArgs(argv: readonly string[]): CliOptions {
	let command: Command = "check";
	let index = 0;
	const firstArgument = argv[0];
	if (isCommand(firstArgument)) {
		command = firstArgument;
		index = 1;
	} else if (firstArgument === "--help" || firstArgument === "-h") {
		command = "help";
		index = 1;
	}

	const options: CliOptions = {
		command,
		configPath: "x-block-checker.config.json",
		usernames: [],
		json: false,
	};

	for (; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === undefined) {
			continue;
		}

		switch (argument) {
			case "--config":
			case "-c":
				options.configPath = requireValue(argv, index++, argument);
				break;
			case "--input":
			case "-i":
				options.inputPath = requireValue(argv, index++, argument);
				break;
			case "--output-dir":
				options.outputDir = requireValue(argv, index++, argument);
				break;
			case "--profile-dir":
				options.profileDir = requireValue(argv, index++, argument);
				break;
			case "--browser":
				options.browserExecutable = requireValue(argv, index++, argument);
				break;
			case "--timeout":
				options.timeoutSeconds = parseTimeout(
					requireValue(argv, index++, argument),
				);
				break;
			case "--relationship-mode":
				options.relationshipMode = parseRelationshipMode(
					requireValue(argv, index++, argument),
				);
				break;
			case "--headed":
				options.headless = false;
				break;
			case "--headless":
				options.headless = true;
				break;
			case "--wait":
				options.wait = true;
				break;
			case "--restart":
				options.restart = true;
				break;
			case "--page-limit":
				options.pageLimit = parsePageLimit(
					requireValue(argv, index++, argument),
				);
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
			case "-h":
				options.command = "help";
				break;
			default:
				if (argument.startsWith("--")) {
					throw new Error(`不明なオプションです: ${argument}`);
				}
				options.usernames.push(argument);
		}
	}

	validateBlockingOptions(options);
	return options;
}
