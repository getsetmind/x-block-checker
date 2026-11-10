import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "./errors";

function parseLockPid(contents: string): number | null {
	const pid = Number(contents.split(/\s+/, 1)[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isProcessRunning(pid: number | null): boolean {
	if (pid === null) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return hasErrorCode(error, "EPERM");
	}
}

async function createLock(lockPath: string): Promise<FileHandle> {
	const handle = await open(lockPath, "wx");
	try {
		await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
		return handle;
	} catch (error) {
		await handle.close();
		await rm(lockPath, { force: true });
		throw error;
	}
}

async function readLockContents(lockPath: string): Promise<string | undefined> {
	try {
		return await readFile(lockPath, "utf8");
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await createLock(lockPath);
		} catch (error) {
			if (!hasErrorCode(error, "EEXIST")) {
				throw error;
			}

			const contents = await readLockContents(lockPath);
			if (contents === undefined) {
				continue;
			}

			if (isProcessRunning(parseLockPid(contents)) || attempt > 0) {
				throw new Error(`別の実行が進行中です: ${lockPath}`, { cause: error });
			}
			await rm(lockPath, { force: true });
		}
	}
	throw new Error(`実行ロックを取得できません: ${lockPath}`);
}

/**
 * run.lockを取得してからactionを実行し、終了時に必ず解放する
 *
 * @typeParam T - actionが返す値の型
 * @param outputDir - ロックファイルを置く出力先
 * @param action - ロック保持中に実行する処理
 * @returns ロック保持中に実行したactionの戻り値
 */
export async function withRunLock<T>(
	outputDir: string,
	action: () => Promise<T>,
): Promise<T> {
	await mkdir(outputDir, { recursive: true });
	const lockPath = join(outputDir, "run.lock");
	const handle = await acquireLock(lockPath);
	try {
		return await action();
	} finally {
		try {
			await handle.close();
		} finally {
			await rm(lockPath, { force: true });
		}
	}
}
