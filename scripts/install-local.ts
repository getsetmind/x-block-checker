import { copyFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const APP_NAME = "x-block-checker";

function executableName(): string {
	return process.platform === "win32" ? `${APP_NAME}.exe` : APP_NAME;
}

function localBinDirectory(): string {
	return process.platform === "win32"
		? join(homedir(), "bin", "tools")
		: join(homedir(), ".local", "bin");
}

const executable = executableName();
const source = resolve("dist", executable);
const installDirectory = localBinDirectory();
const destination = join(installDirectory, executable);
await mkdir(installDirectory, { recursive: true });
await copyFile(source, destination);
process.stdout.write(`インストール: ${destination}\n`);
