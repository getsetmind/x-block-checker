import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("dist", { recursive: true });
const outputPath = resolve(
	"dist",
	process.platform === "win32" ? "x-block-checker.exe" : "x-block-checker",
);
const build = Bun.spawn(
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
const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);
process.stdout.write(`実行ファイル: ${outputPath}\n`);
