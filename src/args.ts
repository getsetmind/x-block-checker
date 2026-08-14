export type Command = "auth" | "check" | "init" | "help";

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
	json: boolean;
}

function requireValue(argv: string[], index: number, option: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${option} の値を指定してください`);
	return value;
}

export function parseArgs(argv: string[]): CliOptions {
	let command: Command = "check";
	let index = 0;
	if (["auth", "check", "init", "help"].includes(argv[0] ?? "")) {
		command = argv[0] as Command;
		index = 1;
	} else if (argv[0] === "--help" || argv[0] === "-h") {
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
		if (argument === "--config" || argument === "-c")
			options.configPath = requireValue(argv, index++, argument);
		else if (argument === "--input" || argument === "-i")
			options.inputPath = requireValue(argv, index++, argument);
		else if (argument === "--output-dir")
			options.outputDir = requireValue(argv, index++, argument);
		else if (argument === "--profile-dir")
			options.profileDir = requireValue(argv, index++, argument);
		else if (argument === "--browser")
			options.browserExecutable = requireValue(argv, index++, argument);
		else if (argument === "--timeout") {
			const seconds = Number(requireValue(argv, index++, argument));
			if (!Number.isFinite(seconds) || seconds < 5 || seconds > 120)
				throw new Error("--timeout は5〜120秒で指定してください");
			options.timeoutSeconds = seconds;
		} else if (argument === "--headed") options.headless = false;
		else if (argument === "--headless") options.headless = true;
		else if (argument === "--json") options.json = true;
		else if (argument === "--help" || argument === "-h")
			options.command = "help";
		else if (argument.startsWith("--"))
			throw new Error(`不明なオプションです: ${argument}`);
		else options.usernames.push(argument);
	}
	return options;
}
