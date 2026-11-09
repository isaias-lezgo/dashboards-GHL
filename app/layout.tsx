import React from "react"
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'

import './globals.css'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Dashboard de Ventas - Lezgo Suite CRM',
  description: 'Dashboard de Lezgo Suite CRM: oportunidades, contactos, citas y tareas en una sola vista.',
}

// Marks <html data-embed> when the panel is framed (GHL's Custom Page), so the
// `embed:` Tailwind variant can drop the branded header. It runs inline in
// <head>, before first paint: deciding in React would mean the SSR'd header
// paints first and then vanishes on hydration, shifting the page ~70px on
// every load inside GHL. Comparing window references is allowed cross-origin;
// the catch covers sandboxes that throw anyway (still a frame).
const EMBED_DETECT_SCRIPT =
  "try{if(window.self!==window.top)document.documentElement.setAttribute('data-embed','')}" +
  "catch(e){document.documentElement.setAttribute('data-embed','')}"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning also covers data-embed, which the server never renders.
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EMBED_DETECT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
