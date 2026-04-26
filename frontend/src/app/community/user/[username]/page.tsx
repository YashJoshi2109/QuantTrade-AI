'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Page() {
  const { username } = useParams<{ username: string }>()
  const router = useRouter()

  useEffect(() => {
    router.replace(`/agora/user/${username}`)
  }, [username, router])

  return null
}
