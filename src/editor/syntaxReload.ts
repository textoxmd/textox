/**
 * 语法重载的宿主入口：编辑器在启动时把自己的重建函数登记进来，
 * 插件运行时的贡献桥在「贡献增删」后调用 `requestSyntaxReload()` 请求重建。
 *
 * 登记前调用是安全的空操作（面板/测试可能先于编辑器创建插件 app）；这类请求
 * 不丢，而是记入 pending，等编辑器登记后由注册方 flush（见 `flushPendingSyntaxReload`）。
 * reloader 返回 `false` 表示暂时不能重建（源码模式 / Agent 逐字插入进行中），
 * 同样记入 pending——否则逐字插入期间改的插件开关会一直停在旧语法上，直到下一次
 * 无关的重载请求。
 */
export type SyntaxReloader = () => boolean;

let current: SyntaxReloader | null = null;
let pending = false;

/** 登记当前编辑器的重建函数；返回的函数只在自己仍是当前登记项时才清除。 */
export function registerSyntaxReloader(fn: SyntaxReloader): () => void {
  current = fn;
  return () => {
    if (current === fn) current = null;
  };
}

/**
 * 请求按最新运行期配置重建语法，返回这次是否真的重建了。
 *
 * 尚无登记项或 reloader 返回 `false`（例如逐字插入中）时记入 pending，由调用方
 * 在条件解除后 flush；reloader 抛错只记日志并同样记入 pending，不影响调用方
 * （注册/注销流程不能被一次失败的重建打断）。
 */
export function requestSyntaxReload(): boolean {
  if (!current) {
    pending = true;
    return false;
  }
  try {
    pending = !current();
    return !pending;
  } catch (error) {
    console.error('[editor] syntax reload failed', error);
    pending = true;
    return false;
  }
}

/** 仅当存在挂起的重载时才重试；流式插入结束、编辑器登记完成时调用。 */
export function flushPendingSyntaxReload(): void {
  if (pending) requestSyntaxReload();
}

/** 是否存在被推迟（尚未真正执行）的重建请求。 */
export function hasPendingSyntaxReload(): boolean {
  return pending;
}
