import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const OUTPUT_DIRECTORY = resolve("dist");
const ENTRYPOINT = "src/cli.ts";

function executableName(): string {
	return process.platform === "win32"
		? "x-block-checker.exe"
		: "x-block-checker";
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
const outputPath = resolve(OUTPUT_DIRECTORY, executableName());
const build = Bun.spawn(
	[
		process.execPath,
		"build",
		"--compile",
		"--minify",
		`--outfile=${outputPath}`,
		ENTRYPOINT,
	],
	{ stdout: "inherit", stderr: "inherit" },
);
const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);
process.stdout.write(`実行ファイル: ${outputPath}\n`);
