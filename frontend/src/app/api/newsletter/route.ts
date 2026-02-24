'use server'

import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = typeof body.email === 'string' ? body.email.trim() : ''

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // In a real deployment, you would persist this to a database
    // or forward to a provider like Mailchimp/ConvertKit here.
    console.log('[newsletter] new subscriber:', email)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[newsletter] error:', error)
    return new Response(
      JSON.stringify({ ok: false, error: 'Server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

