/**
 * Neon Auth stub - Removed to fix memory issues
 * Using JWT auth only
 */

export interface NeonUser {
  id: string
  email: string
  name?: string
  avatar_url?: string
}

export async function neonSignUp(email: string, password: string, name?: string): Promise<any> {
  throw new Error('Neon Auth is disabled. Use JWT authentication.')
}

export async function neonSignIn(email: string, password: string): Promise<any> {
  throw new Error('Neon Auth is disabled. Use JWT authentication.')
}

export async function neonSignOut(): Promise<any> {
  throw new Error('Neon Auth is disabled. Use JWT authentication.')
}

export async function neonGetUser(): Promise<NeonUser | null> {
  return null
}

export function isNeonAuthConfigured(): boolean {
  return false // Disabled
}
