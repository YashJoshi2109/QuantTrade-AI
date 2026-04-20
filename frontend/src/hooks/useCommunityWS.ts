'use client'

import { useEffect, useRef, useCallback } from 'react'

type WSMessage = {
  type: string
  [key: string]: unknown
}

export function useCommunityWS(
  channel: string | null,
  onMessage: (msg: WSMessage) => void,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<NodeJS.Timeout>()

  const connect = useCallback(() => {
    if (!channel) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = process.env.NEXT_PUBLIC_API_URL?.replace(/^https?:\/\//, '') || window.location.host
    const url = `${protocol}//${host}/api/v1/ws/community/${channel}`

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type !== 'pong') {
            onMessage(data)
          }
        } catch { /* ignore parse errors */ }
      }

      ws.onerror = () => {
        ws.close()
      }

      // Ping every 30s to keep alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('ping')
        }
      }, 30000)

      ws.onclose = () => {
        clearInterval(pingInterval)
        // Reconnect after 5 seconds
        reconnectTimer.current = setTimeout(connect, 5000)
      }
    } catch {
      // WebSocket not available, degrade gracefully
    }
  }, [channel, onMessage])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return wsRef
}
