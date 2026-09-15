export type StampHost = { __ffLoaded?: { alive(): boolean } };

// 扩展重新加载后旧 content script 被孤立，但页面（未刷新）里的标记还在；只看布尔值
// 会让重注入跳过 bootstrap、不注册监听器，popup 只能报 “Receiving end does not exist”。
// 存活探针是上一个实例的闭包，在其可能已失效的上下文里执行，据此识别陈旧标记。
export function claimBootstrap(host: StampHost, isAlive: () => boolean): boolean {
  const prev = host.__ffLoaded;
  if (typeof prev?.alive === 'function') {
    try {
      if (prev.alive()) return false;
    } catch {
      // 上下文失效时读取 chrome.runtime 可能抛错，按陈旧处理
    }
  }
  host.__ffLoaded = { alive: isAlive };
  return true;
}
