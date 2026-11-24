import { useMemo } from 'react'

export interface WordCountStats {
  wordCount: number
  charWithSpaces: number
  charWithoutSpaces: number
  paragraphCount: number
}

export function useWordCount(content: string): WordCountStats {
  return useMemo(() => computeWordCount(content || ''), [content])
}

function computeWordCount(text: string): WordCountStats {
  const charWithSpaces = text.length
  const charWithoutSpaces = text.replace(/\s/g, '').length
  const paragraphs = text ? text.split(/\n+/).filter(Boolean).length : 0

  const stripped = text.replace(/\s+/g, ' ').trim()
  if (!stripped) {
    return { wordCount: 0, charWithSpaces, charWithoutSpaces, paragraphCount: paragraphs }
  }

  let wordCount = 0
  let i = 0
  while (i < stripped.length) {
    const code = stripped.codePointAt(i)!
    if (isCJK(code)) {
      wordCount++
      i += code > 0xFFFF ? 2 : 1
    } else if (code === 0x20) {
      i++
    } else {
      wordCount++
      while (i < stripped.length) {
        const c = stripped.codePointAt(i)!
        if (c === 0x20 || isCJK(c)) break
        i += c > 0xFFFF ? 2 : 1
      }
    }
  }

  return { wordCount, charWithSpaces, charWithoutSpaces, paragraphCount: paragraphs }
}

function isCJK(code: number): boolean {
  return (
    (code >= 0x4E00 && code <= 0x9FFF) ||
    (code >= 0x3400 && code <= 0x4DBF) ||
    (code >= 0x2E80 && code <= 0x2EFF) ||
    (code >= 0xF900 && code <= 0xFAFF) ||
    (code >= 0x2F800 && code <= 0x2FA1F) ||
    (code >= 0x3000 && code <= 0x303F) ||
    (code >= 0xFF00 && code <= 0xFFEF) ||
    (code >= 0xAC00 && code <= 0xD7AF) ||
    (code >= 0x3040 && code <= 0x309F) ||
    (code >= 0x30A0 && code <= 0x30FF) ||
    (code >= 0x1100 && code <= 0x11FF) ||
    (code >= 0x3130 && code <= 0x318F) ||
    (code >= 0xA960 && code <= 0xA97F) ||
    (code >= 0xD7B0 && code <= 0xD7FF)
  )
}
