'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User, checkSession, logout as authLogout, login as authLogin, register as authRegister, googleLogin as authGoogleLogin, googleVerify as authGoogleVerify } from '@/lib/auth'
import { isNeonAuthConfigured, neonSignIn, neonSignUp, neonGetUser, neonSignOut, NeonUser } from '@/lib/neon-auth'

export type AuthMethod = 'jwt' | 'neon-auth'

interface AuthContextType {
  user: User | null
  neonUser: NeonUser | null
  isLoading: boolean
  isAuthenticated: boolean
  authMethod: AuthMethod | null
  
  // JWT auth methods
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>
  googleLogin: (googleId: string, email: string, name: string, avatarUrl?: string) => Promise<void>
  googleVerify: (credential: string) => Promise<void>
  
  // Neon Auth methods
  neonLogin: (email: string, password: string) => Promise<void>
  neonRegister: (email: string, password: string, name?: string) => Promise<void>
  
  logout: () => void
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [neonUser, setNeonUser] = useState<NeonUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [authMethod, setAuthMethod] = useState<AuthMethod | null>(null)

  const refreshSession = async () => {
    try {
      // Check JWT session first
      const jwtResult = await checkSession()
      if (jwtResult.user) {
        setUser(jwtResult.user)
        setNeonUser(null)
        setAuthMethod('jwt')
        setIsLoading(false)
        return
      }

      // Check Neon Auth session if JWT not found
      if (isNeonAuthConfigured()) {
        const neonResult = await neonGetUser()
        if (neonResult) {
          setNeonUser(neonResult)
          setUser(null)
          setAuthMethod('neon-auth')
          setIsLoading(false)
          return
        }
      }

      // No session found
      setUser(null)
      setNeonUser(null)
      setAuthMethod(null)
    } catch (error) {
      console.error('Session refresh error:', error)
      setUser(null)
      setNeonUser(null)
      setAuthMethod(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshSession()
  }, [])

  // JWT Auth Methods
  const login = async (email: string, password: string) => {
    const result = await authLogin(email, password)
    setUser(result.user)
    setNeonUser(null)
    setAuthMethod('jwt')
  }

  const register = async (email: string, username: string, password: string, fullName?: string) => {
    const result = await authRegister(email, username, password, fullName)
    setUser(result.user)
    setNeonUser(null)
    setAuthMethod('jwt')
  }

  const googleLogin = async (googleId: string, email: string, name: string, avatarUrl?: string) => {
    const result = await authGoogleLogin(googleId, email, name, avatarUrl)
    setUser(result.user)
    setNeonUser(null)
    setAuthMethod('jwt')
  }

  const googleVerify = async (credential: string) => {
    const result = await authGoogleVerify(credential)
    setUser(result.user)
    setNeonUser(null)
    setAuthMethod('jwt')
  }

  // Neon Auth Methods
  const neonLogin = async (email: string, password: string) => {
    const result = await neonSignIn(email, password)
    if (result?.user) {
      setNeonUser(result.user)
      setUser(null)
      setAuthMethod('neon-auth')
    }
  }

  const neonRegister = async (email: string, password: string, name?: string) => {
    const result = await neonSignUp(email, password, name)
    if (result?.user) {
      setNeonUser(result.user)
      setUser(null)
      setAuthMethod('neon-auth')
    }
  }

  const logout = async () => {
    // Logout from whichever auth method is active
    if (authMethod === 'jwt') {
      authLogout()
    } else if (authMethod === 'neon-auth') {
      await neonSignOut()
    }
    
    setUser(null)
    setNeonUser(null)
    setAuthMethod(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        neonUser,
        isLoading,
        isAuthenticated: !!user || !!neonUser,
        authMethod,
        login,
        register,
        googleLogin,
        googleVerify,
        neonLogin,
        neonRegister,
        logout,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
