import { useState, useEffect } from 'react'
import { useWordCount } from '@/hooks/useWordCount'

interface WordCountBadgeProps {
  content: string
  enabled: boolean
}

/**
 * 字数徽章。关闭时（默认配置）整体不挂载：`useWordCount` 的全文扫描与
 * 300ms 防抖定时器都不再随每次按键重建。
 */
export function WordCountBadge({ content, enabled }: WordCountBadgeProps) {
  if (!enabled) return null
  return <WordCountBadgeContent content={content} />
}

function WordCountBadgeContent({ content }: { content: string }) {
  const [hidden, setHidden] = useState(false)
  const [debounced, setDebounced] = useState(content)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(content), 300)
    return () => clearTimeout(t)
  }, [content])

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | undefined
    let scrollRaf: number | null = null
    const onScroll = () => {
      // 滚动事件很密集：先合并到一帧，避免每次 wheel/touchmove 都重建定时器
      if (scrollRaf !== null) return
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null
        setHidden(true)
        clearTimeout(hideTimer)
        hideTimer = setTimeout(() => setHidden(false), 500)
      })
    }
    window.addEventListener('wheel', onScroll, { passive: true })
    window.addEventListener('touchmove', onScroll, { passive: true })
    return () => {
      window.removeEventListener('wheel', onScroll)
      window.removeEventListener('touchmove', onScroll)
      if (scrollRaf !== null) cancelAnimationFrame(scrollRaf)
      clearTimeout(hideTimer)
    }
  }, [])

  const stats = useWordCount(debounced)

  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
      <div className={`word-count-badge ${hidden ? 'hidden' : 'visible'}`}>
        <span className="tabular-nums">{stats.wordCount}</span>
      </div>
    </div>
  )
}
