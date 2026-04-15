/**
 * WebSocket hook for real-time market data updates.
 *
 * Channels: ideas, pulse, scanner
 * Auto-reconnect with exponential backoff.
 */
import { useEffect, useRef, useState, useCallback } from 'react'

const WS_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, 'ws') || 'ws://localhost:8000'

interface UseMarketWSOptions {
  channel: 'ideas' | 'pulse' | 'scanner'
  token?: string | null
  onMessage?: (data: any) => void
  enabled?: boolean
}

interface UseMarketWSReturn {
  isConnected: boolean
  lastMessage: any | null
  reconnect: () => void
  connectionStatus: 'connected' | 'connecting' | 'disconnected'
}

export function useMarketWebSocket({
  channel,
  token,
  onMessage,
  enabled = true,
}: UseMarketWSOptions): UseMarketWSReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected')
  const [lastMessage, setLastMessage] = useState<any>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const pingTimerRef = useRef<ReturnType<typeof setInterval>>()
  const enabledRef = useRef(enabled)
  const onMessageRef = useRef(onMessage)

  // Keep refs current
  enabledRef.current = enabled
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (!enabledRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setConnectionStatus('connecting')

    const params = token ? `?token=${token}` : ''
    const url = `${WS_BASE}/api/v1/ws/${channel}${params}`

    try {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        setConnectionStatus('connected')
        retryRef.current = 0

        // Ping every 25s to keep alive
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping')
          }
        }, 25000)
      }

      ws.onmessage = (event) => {
        try {
          if (event.data === 'pong') return
          const data = JSON.parse(event.data)
          if (data.type === 'heartbeat') return
          setLastMessage(data)
          onMessageRef.current?.(data)
        } catch {
          // Non-JSON message, ignore
        }
      }

      ws.onclose = () => {
        setIsConnected(false)
        setConnectionStatus('disconnected')
        if (pingTimerRef.current) clearInterval(pingTimerRef.current)

        // Exponential backoff reconnect
        if (enabledRef.current) {
          const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000)
          retryRef.current++
          retryTimerRef.current = setTimeout(connect, delay)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    } catch {
      setConnectionStatus('disconnected')
    }
  }, [channel, token])

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    retryRef.current = 0
    connect()
  }, [connect])

  useEffect(() => {
    if (enabled) {
      connect()
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      if (pingTimerRef.current) clearInterval(pingTimerRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [enabled, connect])

  return { isConnected, lastMessage, reconnect, connectionStatus }
}
