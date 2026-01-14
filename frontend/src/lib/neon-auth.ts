/**
 * Neon Auth integration (optional - use if you want Neon's managed auth)
 * This is an alternative to the custom JWT auth system
 */

const NEON_AUTH_URL = process.env.NEXT_PUBLIC_NEON_AUTH_URL

export interface NeonUser {
  id: string
  email: string
  name?: string
  avatar_url?: string
}

// Only initialize if Neon Auth URL is configured
let authClient: any = null

if (NEON_AUTH_URL && typeof window !== 'undefined') {
  try {
    // Dynamic import to avoid SSR issues
    import('@neondatabase/neon-js/auth').then(({ createAuthClient }) => {
      authClient = createAuthClient(NEON_AUTH_URL)
    })
  } catch (error) {
    console.warn('Neon Auth not available:', error)
  }
}

export async function neonSignUp(email: string, password: string) {
  if (!authClient) {
    throw new Error('Neon Auth not configured. Set NEXT_PUBLIC_NEON_AUTH_URL')
  }
  return await authClient.signUp({ email, password })
}

export async function neonSignIn(email: string, password: string) {
  if (!authClient) {
    throw new Error('Neon Auth not configured. Set NEXT_PUBLIC_NEON_AUTH_URL')
  }
  return await authClient.signIn({ email, password })
}

export async function neonSignOut() {
  if (!authClient) {
    throw new Error('Neon Auth not configured')
  }
  return await authClient.signOut()
}

export async function neonGetUser() {
  if (!authClient) {
    return null
  }
  return await authClient.getUser()
}

export function isNeonAuthConfigured(): boolean {
  return !!NEON_AUTH_URL
}
