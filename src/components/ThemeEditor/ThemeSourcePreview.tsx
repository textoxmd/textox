import { useRef, useEffect } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'

interface ThemeSourcePreviewProps {
  css: string
  onChange?: (css: string) => void
  editable?: boolean
}

export function ThemeSourcePreview({ css: cssContent, onChange, editable }: ThemeSourcePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: cssContent,
      extensions: [
        basicSetup,
        css(),
        oneDark,
        lineNumbers(),
        ...(!editable ? [EditorView.editable.of(false)] : []),
        EditorView.updateListener.of(update => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': {
            fontFamily: 'var(--font-family-mono, monospace)',
            fontSize: '12px',
            padding: '8px',
          },
          '.cm-line': { padding: '0' },
          '.cm-gutters': { border: 'none' },
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (cssContent !== current) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: cssContent },
      })
    }
  }, [cssContent])

  return (
    <div
      ref={containerRef}
      className="border rounded-md overflow-hidden"
      style={editable ? { minHeight: '300px' } : undefined}
    />
  )
}
