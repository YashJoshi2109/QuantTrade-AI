'use client'

import { useState } from 'react'
import AppLayout from '@/components/AppLayout'
import { User, Brain, CreditCard, Key, Bell, CheckCircle } from 'lucide-react'

export default function SettingsPage() {
  const [analystPersonality, setAnalystPersonality] = useState('conservative')
  const [notifications, setNotifications] = useState({
    volatility: true,
    earnings: true,
    updates: false
  })

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
                  <div className="relative">
                    <div className="h-16 w-16 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-xl border-2 border-slate-600">AT</div>
                    <button className="absolute bottom-0 right-0 bg-blue-600 text-white rounded-full p-1 shadow-sm hover:bg-blue-700">
                      <User className="w-3 h-3" />
                    </button>
                  </div>
                  <div>
                    <h4 className="text-base font-medium text-white">Alex Trader</h4>
                    <p className="text-sm text-gray-400">alex.trader@example.com</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Display Name</label>
                    <input type="text" defaultValue="Alex Trader" className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-md text-sm text-white focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-1">Timezone</label>
                    <select className="w-full px-3 py-2 bg-[#131722] border border-slate-700 rounded-md text-sm text-white focus:ring-blue-500 focus:border-blue-500">
                      <option>Eastern Time (US & Canada)</option>
                      <option>Pacific Time (US & Canada)</option>
                      <option>UTC</option>
                    </select>
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

            {/* Subscription & API */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-700 flex justify-between items-center">
                  <h3 className="text-lg font-medium text-white">Subscription</h3>
                  <span className="px-2 py-1 text-xs font-semibold rounded bg-green-900 text-green-200 border border-green-700">ACTIVE</span>
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <div className="mb-4">
                    <h4 className="text-2xl font-bold text-white">Pro Plan</h4>
                    <p className="text-sm text-gray-400 mt-1">$49.00 / month • Renews on Feb 12, 2026</p>
                  </div>
                  <ul className="space-y-3 mb-6 flex-1">
                    {['Real-time Market Data', 'Unlimited AI Queries', 'Advanced Portfolio Analytics'].map((feature) => (
                      <li key={feature} className="flex items-start text-sm text-gray-300">
                        <CheckCircle className="w-4 h-4 text-green-500 mr-2 mt-0.5" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="flex space-x-3 mt-auto">
                    <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors">Manage Subscription</button>
                    <button className="flex-1 bg-transparent border border-slate-700 text-white hover:bg-slate-800 px-4 py-2 rounded-md text-sm font-medium transition-colors">View Invoices</button>
                  </div>
                </div>
              </section>

              <section className="bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-700">
                  <h3 className="text-lg font-medium flex items-center text-white">
                    <Key className="w-5 h-5 mr-2" />
                    API & Integrations
                  </h3>
                </div>
                <div className="p-6 flex-1 flex flex-col space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Personal API Key</label>
                    <div className="flex rounded-md shadow-sm">
                      <input type="text" disabled value="sk_live_51M..." className="flex-1 px-3 py-2 rounded-l-md text-sm bg-[#131722] border border-slate-700 text-gray-500" />
                      <button className="px-4 py-2 border border-l-0 border-slate-700 rounded-r-md bg-[#131722] text-sm font-medium text-gray-300 hover:bg-slate-800">Copy</button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">Use this key to access market data via our REST API. Never share your key.</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium mb-3 text-white">Connected Accounts</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border border-slate-700 rounded-md bg-[#131722]">
                        <div className="flex items-center">
                          <CreditCard className="w-5 h-5 text-gray-400 mr-3" />
                          <div>
                            <p className="text-sm font-medium text-white">Robinhood</p>
                            <p className="text-xs text-gray-400">Last synced: 2 mins ago</p>
                          </div>
                        </div>
                        <button className="text-xs text-red-400 hover:text-red-300">Disconnect</button>
                      </div>
                      <button className="w-full flex justify-center items-center px-4 py-2 border border-dashed border-slate-600 rounded-md text-sm font-medium text-gray-400 hover:bg-slate-800 transition-colors">
                        + Connect Brokerage Account
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

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
