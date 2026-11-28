import type { MetadataRoute } from 'next'

/*
 * Crawl policy (owner decision, 2026-11-28):
 *  - Search engines and AI *answer* bots (fetch a page to answer a user and cite/link us): allowed.
 *  - Bots that only collect content to *train* models: blocked.
 *
 * Cloudflare's managed robots.txt is prepended to this file in production. It already blocks the
 * main training crawlers and sets `Content-Signal: search=yes, ai-train=no`. The groups below must
 * never contradict it (e.g. never Allow GPTBot / ClaudeBot / Google-Extended).
 *
 * Note: a bot that matches a named group ignores the `*` group, so answer bots repeat the same
 * public/private rules.
 */

// Private, per-user or non-content areas. Never indexed by anyone.
const PRIVATE = [
  '/api/',
  '/auth',
  '/settings',
  '/billing',
  '/watchlist',
  '/portfolio',
  '/alerts',
  '/notifications',
  '/connect',
  '/community/messages',
  '/community/bookmarks',
  '/community/create',
  '/community/moderation',
  '/mlops',
  // Duplicate-content / crawl-trap URL patterns
  '/*?*_rsc=',
  '/*?*utm_',
]

// AI answer / user-triggered fetchers: retrieve pages to answer a question and link back.
const ANSWER_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'DuckAssistBot',
  'MistralAI-User',
  'Applebot',
  'bingbot',
  'Googlebot',
]

// Model-training / bulk dataset crawlers.
const TRAINING_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'Google-Extended',
  'GoogleOther',
  'Google-CloudVertexBot',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
  'Meta-ExternalAgent',
  'FacebookBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'omgili',
  'omgilibot',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'PanguBot',
  'Timpibot',
  'ImagesiftBot',
  'img2dataset',
  'Kangaroo Bot',
  'MistralAI-Training',
  'Amazonbot',
  'PetalBot',
  'Scrapy',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      { userAgent: ANSWER_BOTS, allow: '/', disallow: PRIVATE },
      { userAgent: TRAINING_BOTS, disallow: '/' },
    ],
    sitemap: 'https://www.quanttrade.us/sitemap.xml',
    host: 'https://www.quanttrade.us',
  }
}
