import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const executableName =
	process.platform === "win32" ? "x-block-checker.exe" : "x-block-checker";
const source = resolve("dist", executableName);
const installDirectory =
	process.platform === "win32"
		? join(homedir(), "bin", "tools")
		: join(homedir(), ".local", "bin");
const destination = join(installDirectory, executableName);
await mkdir(installDirectory, { recursive: true });
await copyFile(source, destination);
process.stdout.write(`インストール: ${destination}\n`);
