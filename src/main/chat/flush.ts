/**
 * 流式增量落库节流器（docs/03 §5）。
 *
 * 为什么需要它：一轮回答可能有上万个 delta，每个都 UPDATE 一次会拖慢流式渲染；
 * 但只在结束时写一次又会在崩溃时丢掉整轮回答。折中方案是「200ms 或 32 帧」之一先到即落库，
 * 于是最坏情况只丢 200ms 的输出。
 *
 * 它只做节流，不持有业务状态：真正的 content / reasoning 累积在 ChatService 里，
 * flush 回调去读那两个变量 —— 这样不必在内存里维护第二份副本，也就不会出现两份内容不一致。
 */
export class FlushThrottle {
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending = false
  private frames = 0

  constructor(
    private readonly flush: () => void,
    private readonly intervalMs = 200,
    private readonly maxFrames = 32
  ) {}

  /** 每收到一个增量帧调用一次 */
  mark(): void {
    this.pending = true
    this.frames += 1

    // 帧数先到：高频流式下仍然保证每 32 帧落一次，避免定时器被饿死
    if (this.frames >= this.maxFrames) {
      this.run()
      return
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.run()
      }, this.intervalMs)
    }
  }

  /** 立即落库（终态前必须调用，保证尾部字符不丢） */
  run(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pending) return
    this.pending = false
    this.frames = 0
    this.flush()
  }

  /** 清掉定时器并做最后一次落库 */
  dispose(): void {
    this.run()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
