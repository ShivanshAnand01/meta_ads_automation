'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

/**
 * Theme provider.
 *
 * `next-themes` was already a dependency but was never mounted, so the `.dark`
 * token block in globals.css could never apply. The result: a viewer whose OS
 * is set to dark got the browser's own auto-darkening applied to a page that
 * declared no color-scheme — pale text on a white card, close to unreadable.
 *
 * With this mounted and `color-scheme` declared in globals.css, dark mode is a
 * real, consistent theme.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
