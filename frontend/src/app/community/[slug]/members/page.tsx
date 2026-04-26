'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Page() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()

  useEffect(() => {
    router.replace(`/agora/${slug}/members`)
  }, [slug, router])

  return null
}
