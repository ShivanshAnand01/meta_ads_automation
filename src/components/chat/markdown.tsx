'use client'

import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// Stable plugin arrays: new arrays each render made react-markdown rebuild
// its processor every time.
const REMARK = [remarkGfm]
const REHYPE_FULL = [rehypeHighlight]
const REHYPE_NONE: [] = []

/**
 * Assistant markdown. Memoised on its text, so a finished message never
 * re-renders while another one streams. Syntax highlighting is skipped
 * during streaming (it re-tokenises every code block on every frame) and
 * applied once the message is complete.
 */
export const Markdown = memo(function Markdown({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className="chat-md"
    >
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={streaming ? REHYPE_NONE : REHYPE_FULL}>
        {content}
      </ReactMarkdown>
    </div>
  )
})
