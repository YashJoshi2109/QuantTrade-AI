'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User, checkSession, logout as authLogout, login as authLogin, register as authRegister, googleLogin as authGoogleLogin, googleVerify as authGoogleVerify } from '@/lib/auth'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string, fullName?: string) => Promise<void>
  googleLogin: (googleId: string, email: string, name: string, avatarUrl?: string) => Promise<void>
  googleVerify: (credential: string) => Promise<void>
  logout: () => void
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshSession = async () => {
    try {
      const result = await checkSession()
      setUser(result.user)
    } catch (error) {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshSession()
  }, [])

  const login = async (email: string, password: string) => {
    const result = await authLogin(email, password)
    setUser(result.user)
  }

  const register = async (email: string, username: string, password: string, fullName?: string) => {
    const result = await authRegister(email, username, password, fullName)
    setUser(result.user)
  }

  const googleLogin = async (googleId: string, email: string, name: string, avatarUrl?: string) => {
    const result = await authGoogleLogin(googleId, email, name, avatarUrl)
    setUser(result.user)
  }

  const googleVerify = async (credential: string) => {
    const result = await authGoogleVerify(credential)
    setUser(result.user)
  }

  const logout = () => {
    authLogout()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        googleLogin,
        googleVerify,
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
