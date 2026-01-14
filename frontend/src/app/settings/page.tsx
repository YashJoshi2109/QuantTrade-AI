'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import AppLayout from '@/components/AppLayout'
import { Brain, Bell, CheckCircle, LogIn, Camera } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function SettingsPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [analystPersonality, setAnalystPersonality] = useState('conservative')
  const [notifications, setNotifications] = useState({
    volatility: true,
    earnings: true,
    updates: false
  })
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setUploadingPhoto(true)
    try {
      // TODO: Implement photo upload to backend
      // For now, just show a preview
      const reader = new FileReader()
      reader.onload = (event) => {
        // In production, upload to backend/S3 and update user profile
        console.log('Photo selected:', file.name)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Photo upload error:', error)
    } finally {
      setUploadingPhoto(false)
    }
  }
  
  const displayName = user?.full_name || user?.username || 'Trader'
  const email = user?.email || '—'
  const avatarUrl = user?.avatar_url
  
  // Show auth gate if not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center min-h-[80vh]">
          <div className="text-center max-w-md">
            <div className="hud-panel p-8">
              <LogIn className="w-16 h-16 text-blue-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Sign In Required</h2>
              <p className="text-slate-400 mb-6">
                Create an account to access settings and personalize your experience.
              </p>
              <Link 
                href="/auth"
                className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                Sign In / Register
              </Link>
            </div>
          </div>
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold mb-6 text-white">Settings & Preferences</h1>
          
          <div className="space-y-6">
            {/* Profile Information */}
            <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                <h3 className="text-lg font-medium text-white">Profile Information</h3>
                <button className="text-sm text-blue-400 hover:text-blue-300 font-medium">Edit Profile</button>
              </div>
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-center space-x-4">
                  <div className="relative group">
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt={displayName}
                        className="h-16 w-16 rounded-full object-cover border-2 border-slate-600"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-xl border-2 border-slate-600">
                        {displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute bottom-0 right-0 bg-blue-600 text-white rounded-full p-2 shadow-lg hover:bg-blue-700 transition-all opacity-0 group-hover:opacity-100"
                      disabled={uploadingPhoto}
                    >
                      {uploadingPhoto ? (
                        <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Camera className="w-3 h-3" />
                      )}
                    </button>
                    <input 
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </div>
                  <div>
                    <h4 className="text-base font-medium text-white">{displayName}</h4>
                    <p className="text-sm text-gray-400">{email}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
                    <input 
                      type="text" 
                      value={user?.username || ''} 
                      readOnly
                      className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-md text-sm text-white cursor-not-allowed opacity-75"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Email</label>
                    <input 
                      type="text" 
                      value={email} 
                      readOnly
                      className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-md text-sm text-white cursor-not-allowed opacity-75"
                    />
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Account created: {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                  </div>
                </div>
              </div>
            </section>

            {/* AI Customization */}
            <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-medium flex items-center text-white">
                  <Brain className="w-5 h-5 mr-2 text-blue-400" />
                  AI Customization
                </h3>
                <p className="mt-1 text-sm text-gray-400">Tailor the AI Copilot to your trading style and risk tolerance.</p>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-white">Analyst Personality</h4>
                    <p className="text-xs text-gray-400 mt-1">Adjusts the tone and risk-aversion of generated insights.</p>
                  </div>
                  <div className="flex items-center bg-[#131722] rounded-lg p-1">
                    {['conservative', 'balanced', 'aggressive'].map((type) => (
                      <button
                        key={type}
                        onClick={() => setAnalystPersonality(type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${analystPersonality === type ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <hr className="border-slate-700" />
                <div>
                  <h4 className="text-sm font-medium mb-3 text-white">Data Sources Priority</h4>
                  <div className="space-y-3">
                    {[
                      { id: 'sec', label: 'SEC Filings Analysis', enabled: false },
                      { id: 'social', label: 'Social Sentiment (Reddit/X)', enabled: true },
                      { id: 'technical', label: 'Technical Indicators (RSI, MACD)', enabled: true }
                    ].map((source) => (
                      <div key={source.id} className="flex items-center justify-between">
                        <span className="text-sm text-gray-300">{source.label}</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" defaultChecked={source.enabled} className="sr-only peer" />
                          <div className="w-10 h-5 bg-slate-600 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Account Info */}
            <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-medium text-white">Account Information</h3>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Account Type:</span>
                    <span className="text-white font-medium ml-2">Free Plan</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Member Since:</span>
                    <span className="text-white font-medium ml-2">
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Verified:</span>
                    <span className="text-white font-medium ml-2">
                      {user?.is_verified ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Status:</span>
                    <span className="text-green-400 font-medium ml-2 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Active
                    </span>
                  </div>
                </div>
                <div className="pt-4 border-t border-slate-700">
                  <p className="text-xs text-slate-400">
                    All features are currently free. Enjoy unlimited access to real-time market data, AI analysis, and portfolio tracking.
                  </p>
                </div>
              </div>
            </section>

            {/* Notifications */}
            <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-700">
                <h3 className="text-lg font-medium flex items-center text-white">
                  <Bell className="w-5 h-5 mr-2" />
                  Notifications
                </h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  {[
                    { id: 'volatility', label: 'Market Volatility Alerts', desc: 'Get notified when watched assets move >5% in 1 hour.', enabled: notifications.volatility },
                    { id: 'earnings', label: 'Earnings Reports', desc: 'Daily summary of upcoming earnings for your watchlist.', enabled: notifications.earnings },
                    { id: 'updates', label: 'Product Updates', desc: 'News about new AI features and platform improvements.', enabled: notifications.updates }
                  ].map((notif) => (
                    <div key={notif.id} className="flex items-center justify-between py-2">
                      <div>
                        <p className="text-sm font-medium text-white">{notif.label}</p>
                        <p className="text-xs text-gray-400">{notif.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={notif.enabled}
                          onChange={(e) => setNotifications({ ...notifications, [notif.id]: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-10 h-5 bg-slate-600 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Danger Zone */}
            <div className="border-t border-slate-700 pt-6">
              <h3 className="text-lg font-medium text-red-400 mb-4">Danger Zone</h3>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-red-900/10 border border-red-900/30 rounded-lg p-4">
                <div className="mb-4 sm:mb-0">
                  <h4 className="text-sm font-bold text-red-400">Delete Account</h4>
                  <p className="text-xs text-red-300/70 mt-1">Once you delete your account, there is no going back. Please be certain.</p>
                </div>
                <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap">Delete Account</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
