/**
 * Batch translation queue — concurrency-limited, resumable.
 * Pure logic (no Zotero dependency) → fully unit tested.
 */

export interface BatchJob {
  id: string;
  text: string;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
  error?: string;
}

export interface BatchQueueOptions {
  concurrency?: number;
  translator: (text: string) => Promise<string>;
}

export class BatchQueue {
  private jobs: BatchJob[] = [];
  private running = 0;
  private cancelled = false;
  private readonly opts: Required<BatchQueueOptions>;

  constructor(opts: BatchQueueOptions) {
    this.opts = {
      concurrency: 1,
      ...opts,
    };
  }

  load(items: string[]): void {
    this.cancelled = false;
    this.jobs = items.map((text, idx) => ({
      id: `job-${idx}`,
      text,
      status: "pending",
    }));
  }

  snapshot(): BatchJob[] {
    return this.jobs.map((j) => ({ ...j }));
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(onProgress?: (state: BatchJob[]) => void): Promise<void> {
    // 本次要处理的任务在调用时刻一次性确定, 与旧实现一致:
    // 只认当下的 pending/failed, 运行期间新变成 pending 的任务不补做
    const list = this.jobs.filter(
      (j) => j.status === "pending" || j.status === "failed",
    );

    // 旧实现把 await translator 写在 for 循环体内, 单个任务没结束就不会取下一个,
    // 因此同一时刻至多一个任务在跑, 限流 while 判断永远不成立, "并发 N" 从未生效;
    // 改成 N 个 worker 共享游标各自取任务, 才能真正同时压住 N 个在途翻译。
    const limit = Math.max(1, Math.floor(this.opts.concurrency));
    const workerCount = Math.min(limit, list.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      // 每个 worker 循环取号; 取完退出, 取消后也不再接手新任务(剩余任务保持 pending)
      while (!this.cancelled) {
        const index = cursor++;
        if (index >= list.length) break;
        const job = list[index]!;
        this.running++;
        job.status = "running";
        onProgress?.(this.snapshot());
        try {
          job.result = await this.opts.translator(job.text);
          job.status = "done";
        } catch (e) {
          // 单个任务失败只标记, 不向上抛, 不影响其它 worker
          job.error = (e as Error).message;
          job.status = "failed";
        } finally {
          this.running--;
          onProgress?.(this.snapshot());
        }
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    );
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
