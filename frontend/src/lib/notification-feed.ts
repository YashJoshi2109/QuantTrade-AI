/**
 * Single source of truth for the notifications feed.
 *
 * The header bell dropdown and the full /notifications page both read
 * `/api/v1/notifications` and categorise rows with the same rules, so the two
 * views can never disagree (previously the dropdown mixed in ML prediction
 * alerts that the page never showed).
 */
import type { Notification } from '@/lib/api'

export const SOCIAL_TYPES = new Set(['reply', 'upvote', 'mention', 'follow', 'dm', 'follow_post', 'community_post'])
export const TRADING_TYPES = new Set(['alert', 'price_alert', 'portfolio', 'trade'])

export type NotificationCategory = 'all' | 'unread' | 'social' | 'trading' | 'system'

/** react-query key shared by the bell dropdown and the /notifications page. */
export const NOTIFICATION_FEED_KEY = ['notifications-feed'] as const
export const NOTIFICATION_UNREAD_KEY = ['notifications-unread-count'] as const

export function filterNotificationsByCategory(
  notifications: Notification[],
  category: NotificationCategory
): Notification[] {
  switch (category) {
    case 'unread':
      return notifications.filter((n) => !n.is_read)
    case 'social':
      return notifications.filter((n) => SOCIAL_TYPES.has(n.type))
    case 'trading':
      return notifications.filter((n) => TRADING_TYPES.has(n.type))
    case 'system':
      return notifications.filter((n) => !SOCIAL_TYPES.has(n.type) && !TRADING_TYPES.has(n.type))
    default:
      return notifications
  }
}
