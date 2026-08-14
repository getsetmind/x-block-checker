import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const executable =
	process.platform === "win32" ? "x-block-checker.exe" : "x-block-checker";
const installDirectory =
	process.platform === "win32"
		? join(homedir(), "bin", "tools")
		: join(homedir(), ".local", "bin");
const destination = join(installDirectory, executable);
await mkdir(installDirectory, { recursive: true });
await copyFile(resolve("dist", executable), destination);
process.stdout.write(`インストール: ${destination}\n`);
