import https from "https";
import http, { IncomingMessage } from "http";
import { promises as fs } from "fs";
import { join } from "path";
import { ConfigService } from "./config";
import { formatAvatarCacheConsoleEvent } from "./runtimeConsolePrivacy";
import {
  AVATAR_DOWNLOAD_MAX_BYTES,
  AVATAR_DOWNLOAD_MAX_REDIRECTS,
  AVATAR_DOWNLOAD_TIMEOUT_MS,
  isSupportedAvatarContentType,
  isSupportedAvatarImage,
  parseSafeAvatarUrl,
} from "./avatarDownloadPolicy";
import { resolvePublicAddress } from "./webSnapshotService";

// 头像文件缓存服务 - 复用项目已有的缓存目录结构
export class AvatarFileCacheService {
  private static instance: AvatarFileCacheService | null = null;

  // 头像文件缓存目录
  private readonly cacheDir: string;
  // 头像URL -> 本地文件路径的内存缓存（仅追踪正在下载的）
  private readonly pendingDownloads: Map<string, Promise<string | null>> =
    new Map();
  // LRU 追踪：文件路径->最后访问时间
  private readonly lruOrder: string[] = [];
  private readonly maxCacheFiles = 100;

  private constructor() {
    const basePath = ConfigService.getInstance().getCacheBasePath();
    this.cacheDir = join(basePath, "avatar-files");
    this.ensureCacheDir();
    this.loadLruOrder();
  }

  public static getInstance(): AvatarFileCacheService {
    if (!AvatarFileCacheService.instance) {
      AvatarFileCacheService.instance = new AvatarFileCacheService();
    }
    return AvatarFileCacheService.instance;
  }

  private ensureCacheDir(): void {
    // 同步确保目录存在（构造函数调用）
    try {
      fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 })
        .then(() => fs.chmod(this.cacheDir, 0o700))
        .catch(() => {});
    } catch {}
  }

  private async ensureCacheDirAsync(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.cacheDir, 0o700);
    } catch {}
  }

  private getFilePath(url: string): string {
    // 使用URL的hash作为文件名，避免特殊字符问题
    const hash = this.hashString(url);
    return join(this.cacheDir, `avatar_${hash}.png`);
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(16);
  }

  private async loadLruOrder(): Promise<void> {
    try {
      const entries = await fs.readdir(this.cacheDir);
      // 按修改时间排序（旧的在前）
      const filesWithTime: { file: string; mtime: number }[] = [];
      for (const entry of entries) {
        if (!entry.startsWith("avatar_") || !entry.endsWith(".png")) continue;
        try {
          const stat = await fs.stat(join(this.cacheDir, entry));
          await fs.chmod(join(this.cacheDir, entry), 0o600);
          filesWithTime.push({ file: entry, mtime: stat.mtimeMs });
        } catch {}
      }
      filesWithTime.sort((a, b) => a.mtime - b.mtime);
      this.lruOrder.length = 0;
      this.lruOrder.push(...filesWithTime.map((f) => f.file));
    } catch {}
  }

  private updateLru(fileName: string): void {
    const index = this.lruOrder.indexOf(fileName);
    if (index > -1) {
      this.lruOrder.splice(index, 1);
    }
    this.lruOrder.push(fileName);
  }

  private async evictIfNeeded(): Promise<void> {
    while (this.lruOrder.length >= this.maxCacheFiles) {
      const oldest = this.lruOrder.shift();
      if (oldest) {
        try {
          await fs.rm(join(this.cacheDir, oldest));
          console.log(formatAvatarCacheConsoleEvent("evicted"));
        } catch {}
      }
    }
  }

  private async downloadAvatar(url: string): Promise<string | null> {
    const localPath = this.getFilePath(url);

    // 检查文件是否已存在
    try {
      await fs.access(localPath);
      await fs.chmod(localPath, 0o600);
      const fileName = localPath.split("/").pop()!;
      this.updateLru(fileName);
      return localPath;
    } catch {}

    await this.ensureCacheDirAsync();
    await this.evictIfNeeded();

    const buffer = await this.fetchAvatar(url).catch(() => null);
    if (!buffer) return null;

    const temporaryPath = `${localPath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporaryPath, buffer, { mode: 0o600 });
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, localPath);
      await fs.chmod(localPath, 0o600);
      const fileName = localPath.split("/").pop()!;
      this.updateLru(fileName);
      console.log(formatAvatarCacheConsoleEvent("downloaded"));
      return localPath;
    } catch {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
      return null;
    }
  }

  private async fetchAvatar(input: string, redirectCount = 0): Promise<Buffer | null> {
    if (redirectCount > AVATAR_DOWNLOAD_MAX_REDIRECTS) return null;
    const url = parseSafeAvatarUrl(input);
    if (!url) return null;
    const resolved = await resolvePublicAddress(url.hostname);
    if (!resolved) return null;

    return new Promise<Buffer | null>((resolve) => {
      const options = {
        protocol: url.protocol,
        hostname: resolved.address,
        family: resolved.family,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
        headers: {
          Host: url.host,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090719) XWEB/8351",
          Referer: "https://servicewechat.com/",
          Accept: "image/png,image/jpeg,image/gif,image/webp",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Connection: "keep-alive",
        },
      };

      const callback = (res: IncomingMessage) => {
        if (
          res.statusCode && res.statusCode >= 300 && res.statusCode < 400 &&
          res.headers.location && redirectCount < AVATAR_DOWNLOAD_MAX_REDIRECTS
        ) {
          res.resume();
          try {
            const target = new URL(res.headers.location, url);
            resolve(this.fetchAvatar(target.href, redirectCount + 1));
          } catch {
            resolve(null);
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        if (!isSupportedAvatarContentType(res.headers["content-type"])) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        let rejected = false;
        res.on("data", (chunk: Buffer) => {
          if (rejected) return;
          total += chunk.length;
          if (total > AVATAR_DOWNLOAD_MAX_BYTES) {
            rejected = true;
            res.destroy();
            resolve(null);
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          if (rejected) return;
          const buffer = Buffer.concat(chunks);
          resolve(buffer.length > 0 && isSupportedAvatarImage(buffer) ? buffer : null);
        });
        res.on("error", () => resolve(null));
      };

      const req = url.protocol === "https:"
        ? https.request(options, callback)
        : http.request(options, callback);

      req.on("error", () => resolve(null));
      req.setTimeout(AVATAR_DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });
  }

  /**
   * 获取头像本地文件路径，如果需要会下载
   * 同一URL并发调用会复用同一个下载任务
   */
  async getAvatarPath(url: string): Promise<string | null> {
    if (!url) return null;

    // 检查是否有正在进行的下载
    const pending = this.pendingDownloads.get(url);
    if (pending) {
      return pending;
    }

    // 发起新下载
    const downloadPromise = this.downloadAvatar(url);
    this.pendingDownloads.set(url, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.pendingDownloads.delete(url);
    }
  }

  // 清理所有缓存文件（App退出时调用）
  async clearCache(): Promise<void> {
    try {
      const entries = await fs.readdir(this.cacheDir);
      for (const entry of entries) {
        if (entry.startsWith("avatar_") && entry.endsWith(".png")) {
          try {
            await fs.rm(join(this.cacheDir, entry));
          } catch {}
        }
      }
      this.lruOrder.length = 0;
      console.log(formatAvatarCacheConsoleEvent("cleared"));
    } catch {}
  }

  // 获取当前缓存的文件数量
  async getCacheCount(): Promise<number> {
    try {
      const entries = await fs.readdir(this.cacheDir);
      return entries.filter(
        (e) => e.startsWith("avatar_") && e.endsWith(".png"),
      ).length;
    } catch {
      return 0;
    }
  }
}

export const avatarFileCache = AvatarFileCacheService.getInstance();
