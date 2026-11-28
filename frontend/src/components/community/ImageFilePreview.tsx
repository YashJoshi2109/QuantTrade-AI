'use client'

import { useEffect, useRef } from 'react'

/**
 * Thumbnail of a user-selected image file, drawn on a canvas.
 * Decoding with createImageBitmap means no user-derived URL is ever put in the DOM.
 */
export default function ImageFilePreview({ file, size = 48, className }: { file: File; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    const canvas = ref.current
    if (!canvas || typeof createImageBitmap !== 'function') return
    createImageBitmap(file)
      .then((bmp) => {
        bitmap = bmp
        if (cancelled) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
        canvas.width = size * dpr
        canvas.height = size * dpr
        // object-fit: cover
        const scale = Math.max(canvas.width / bmp.width, canvas.height / bmp.height)
        const w = bmp.width * scale
        const h = bmp.height * scale
        ctx.drawImage(bmp, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [file, size])

  return <canvas ref={ref} role="img" aria-label="Selected image preview" style={{ width: size, height: size }} className={className} />
}
