import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("dist", { recursive: true });
const executableName =
	process.platform === "win32" ? "x-block-checker.exe" : "x-block-checker";
const outputPath = resolve("dist", executableName);
const processResult = Bun.spawn(
	[
		process.execPath,
		"build",
		"--compile",
		"--minify",
		`--outfile=${outputPath}`,
		"src/cli.ts",
	],
	{ stdout: "inherit", stderr: "inherit" },
);
const exitCode = await processResult.exited;
if (exitCode !== 0) process.exit(exitCode);
process.stdout.write(`実行ファイル: ${outputPath}\n`);
