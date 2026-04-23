"use client"

import * as React from "react"
import {
  MessageSquare,
  Phone,
  CircleDot,
  Settings,
  Search,
  Video,
  PhoneCall,
  Smile,
  Paperclip,
  Send,
  Mic,
  Image,
  FileText,
  MapPin,
  User,
  Camera,
  ChevronDown,
  Check,
  CheckCheck,
  MoreVertical,
  Plus,
  Star,
  Archive,
  Bell,
  Lock,
  HelpCircle,
  LogOut,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@/components/blocks/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// ── Types ────────────────────────────────────────────────────────────────
interface Contact {
  id: string
  name: string
  avatar?: string
  initials: string
  lastMessage: string
  time: string
  unread?: number
  online?: boolean
  typing?: boolean
}

interface Message {
  id: string
  content: string
  time: string
  sent: boolean
  status?: "sent" | "delivered" | "read"
}

// ── Mock Data ────────────────────────────────────────────────────────────
const contacts: Contact[] = [
  {
    id: "1",
    name: "Sarah Chen",
    initials: "SC",
    lastMessage: "AAPL just broke above resistance!",
    time: "2m",
    unread: 3,
    online: true,
  },
  {
    id: "2",
    name: "Marcus Webb",
    initials: "MW",
    lastMessage: "Check the LSTM model output",
    time: "15m",
    online: true,
    typing: true,
  },
  {
    id: "3",
    name: "Priya Sharma",
    initials: "PS",
    lastMessage: "Portfolio rebalance complete",
    time: "1h",
    unread: 1,
    online: false,
  },
  {
    id: "4",
    name: "Alex Rodriguez",
    initials: "AR",
    lastMessage: "Sent you the backtest results",
    time: "3h",
    online: false,
  },
  {
    id: "5",
    name: "Trading Group",
    initials: "TG",
    lastMessage: "James: Bear flag forming on SPY",
    time: "4h",
    unread: 12,
    online: true,
  },
  {
    id: "6",
    name: "Emily Nakamura",
    initials: "EN",
    lastMessage: "Thanks for the alpha signal!",
    time: "Yesterday",
    online: false,
  },
  {
    id: "7",
    name: "David Kim",
    initials: "DK",
    lastMessage: "Meeting at 3pm for strategy review",
    time: "Yesterday",
    online: false,
  },
  {
    id: "8",
    name: "Risk Alerts",
    initials: "RA",
    lastMessage: "VaR threshold breached on portfolio B",
    time: "2d",
    unread: 5,
    online: true,
  },
]

const messages: Message[] = [
  {
    id: "1",
    content: "Hey, have you seen the latest AAPL price action?",
    time: "10:30 AM",
    sent: false,
  },
  {
    id: "2",
    content: "Yeah! It just broke above the 200-day MA. The LSTM model flagged it yesterday.",
    time: "10:31 AM",
    sent: true,
    status: "read",
  },
  {
    id: "3",
    content: "The volume is confirming too. 2.3x average volume on the breakout candle.",
    time: "10:32 AM",
    sent: false,
  },
  {
    id: "4",
    content: "I ran the backtest overnight. The model shows 73% probability of continuation to $195 within 5 sessions.",
    time: "10:33 AM",
    sent: true,
    status: "read",
  },
  {
    id: "5",
    content: "That aligns with the options flow I'm seeing. Heavy call buying at $190 and $195 strikes.",
    time: "10:35 AM",
    sent: false,
  },
  {
    id: "6",
    content: "Should we size up? Current position is only 2% of portfolio.",
    time: "10:36 AM",
    sent: true,
    status: "delivered",
  },
  {
    id: "7",
    content: "AAPL just broke above resistance! RSI not overbought yet, momentum is strong. Let's take it to 3.5% with a stop at $182.",
    time: "10:38 AM",
    sent: false,
  },
]

// ── Nav Sidebar Content ──────────────────────────────────────────────────
const navItems = [
  { icon: MessageSquare, label: "Messages", active: true },
  { icon: Phone, label: "Calls", active: false },
  { icon: CircleDot, label: "Status", active: false },
]

function NavSidebarContent() {
  return (
    <>
      <SidebarHeader className="items-center py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/20">
          <MessageSquare className="h-5 w-5 text-cyan-400" />
        </div>
      </SidebarHeader>

      <SidebarContent className="items-center">
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton
                tooltip={item.label}
                isActive={item.active}
                className={
                  item.active
                    ? "text-cyan-400 bg-white/[0.08]"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
                }
              >
                <item.icon className="h-5 w-5" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="items-center gap-3 pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              className="text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
            >
              <Settings className="h-5 w-5" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip="Account"
                  className="hover:bg-white/[0.06]"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-[10px] font-bold">
                      YJ
                    </AvatarFallback>
                  </Avatar>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                className="w-56 bg-[#1a1f2e] border-white/10 text-slate-200"
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white text-xs font-bold">
                      YJ
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-slate-200">Yash Joshi</p>
                    <p className="text-xs text-slate-400">yash@quanttrade.ai</p>
                  </div>
                </div>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                  <Star className="mr-2 h-4 w-4" />
                  Starred Messages
                </DropdownMenuItem>
                <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                  <Archive className="mr-2 h-4 w-4" />
                  Archived
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                  <Bell className="mr-2 h-4 w-4" />
                  Notifications
                </DropdownMenuItem>
                <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                  <Lock className="mr-2 h-4 w-4" />
                  Privacy
                </DropdownMenuItem>
                <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Help
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem className="text-red-400 focus:bg-red-500/10 focus:text-red-400">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  )
}

// ── Chat List Panel ──────────────────────────────────────────────────────
function ChatListPanel() {
  const [activeContact, setActiveContact] = React.useState("1")
  const [searchQuery, setSearchQuery] = React.useState("")

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-full flex-col bg-[#0a0e14]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-lg font-semibold text-slate-200">Chats</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search or start new chat"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 bg-white/[0.04] border-white/10 pl-9 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:ring-cyan-500/30"
          />
        </div>
      </div>

      {/* Contact List */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {filteredContacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => setActiveContact(contact.id)}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeContact === contact.id
                  ? "bg-white/[0.08] border-l-2 border-cyan-400"
                  : "hover:bg-white/[0.04] border-l-2 border-transparent"
              }`}
            >
              <div className="relative flex-shrink-0">
                <Avatar className="h-11 w-11">
                  {contact.avatar ? (
                    <AvatarImage src={contact.avatar} alt={contact.name} />
                  ) : null}
                  <AvatarFallback className="bg-gradient-to-br from-slate-700 to-slate-800 text-slate-300 text-xs font-medium border border-white/10">
                    {contact.initials}
                  </AvatarFallback>
                </Avatar>
                {contact.online && (
                  <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#0a0e14] bg-emerald-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200 truncate">
                    {contact.name}
                  </span>
                  <span
                    className={`text-[11px] flex-shrink-0 ${
                      contact.unread ? "text-cyan-400" : "text-slate-500"
                    }`}
                  >
                    {contact.time}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-slate-400 truncate pr-2">
                    {contact.typing ? (
                      <span className="text-emerald-400 italic">typing...</span>
                    ) : (
                      contact.lastMessage
                    )}
                  </span>
                  {contact.unread ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-bold text-white flex-shrink-0">
                      {contact.unread}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ── Active Chat Panel ────────────────────────────────────────────────────
function ActiveChatPanel() {
  const [inputValue, setInputValue] = React.useState("")
  const activeContact = contacts[0] // Sarah Chen

  return (
    <div className="flex h-full flex-col bg-[#0a0e14]">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-gradient-to-br from-slate-700 to-slate-800 text-slate-300 text-xs font-medium border border-white/10">
                {activeContact.initials}
              </AvatarFallback>
            </Avatar>
            {activeContact.online && (
              <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#0a0e14] bg-emerald-500" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              {activeContact.name}
            </h3>
            <p className="text-[11px] text-emerald-400">online</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <Video className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <PhoneCall className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {/* Encryption notice */}
          <div className="mx-auto mb-4 flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-500 border border-white/[0.05]">
            <Lock className="h-3 w-3" />
            Messages are end-to-end encrypted
          </div>

          {/* Date separator */}
          <div className="flex items-center gap-3 my-2">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[11px] text-slate-500 bg-[#131820] px-3 py-0.5 rounded-full">
              Today
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.sent ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`group relative max-w-[75%] rounded-2xl px-3.5 py-2 ${
                  message.sent
                    ? "bg-cyan-600/20 border border-cyan-500/20 rounded-br-md"
                    : "bg-[#131820] border border-white/[0.06] rounded-bl-md"
                }`}
              >
                <p className="text-[13px] leading-relaxed text-slate-200">
                  {message.content}
                </p>
                <div
                  className={`mt-1 flex items-center gap-1 ${
                    message.sent ? "justify-end" : "justify-start"
                  }`}
                >
                  <span className="text-[10px] text-slate-500">
                    {message.time}
                  </span>
                  {message.sent && message.status && (
                    <span className="text-slate-500">
                      {message.status === "read" ? (
                        <CheckCheck className="h-3.5 w-3.5 text-cyan-400" />
                      ) : message.status === "delivered" ? (
                        <CheckCheck className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Input Bar */}
      <div className="border-t border-white/10 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {/* Emoji */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 flex-shrink-0 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
          >
            <Smile className="h-5 w-5" />
          </Button>

          {/* Attach dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 flex-shrink-0 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-48 bg-[#1a1f2e] border-white/10 text-slate-200"
            >
              <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                <Image className="mr-2 h-4 w-4 text-violet-400" />
                Photos & Videos
              </DropdownMenuItem>
              <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                <Camera className="mr-2 h-4 w-4 text-rose-400" />
                Camera
              </DropdownMenuItem>
              <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                <FileText className="mr-2 h-4 w-4 text-cyan-400" />
                Document
              </DropdownMenuItem>
              <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                <User className="mr-2 h-4 w-4 text-blue-400" />
                Contact
              </DropdownMenuItem>
              <DropdownMenuItem className="text-slate-300 focus:bg-white/[0.06] focus:text-slate-200">
                <MapPin className="mr-2 h-4 w-4 text-emerald-400" />
                Location
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Text input */}
          <div className="relative flex-1">
            <Input
              placeholder="Type a message"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="h-10 bg-[#131820] border-white/10 text-sm text-slate-200 placeholder:text-slate-500 pr-10 focus-visible:ring-cyan-500/30"
              onKeyDown={(e) => {
                if (e.key === "Enter" && inputValue.trim()) {
                  setInputValue("")
                }
              }}
            />
          </div>

          {/* Send / Mic */}
          {inputValue.trim() ? (
            <Button
              size="icon"
              className="h-9 w-9 flex-shrink-0 bg-cyan-500 hover:bg-cyan-600 text-white rounded-full"
              onClick={() => setInputValue("")}
            >
              <Send className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 flex-shrink-0 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]"
            >
              <Mic className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Home (Main Export) ───────────────────────────────────────────────────
export function Home() {
  return (
    <SidebarProvider
      defaultOpen={true}
      style={
        {
          "--sidebar-width": "3.5rem",
          "--sidebar-width-icon": "3.5rem",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-full overflow-hidden bg-[#0a0e14]">
        {/* Left icon sidebar */}
        <Sidebar
          collapsible="icon"
          className="border-r border-white/10 bg-[#060a10]"
        >
          <NavSidebarContent />
        </Sidebar>

        {/* Main content area */}
        <SidebarInset className="flex-1 p-0 bg-[#0a0e14]">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            {/* Chat list panel */}
            <ResizablePanel
              defaultSize={25}
              minSize={20}
              maxSize={35}
              className="border-r border-white/10"
            >
              <ChatListPanel />
            </ResizablePanel>

            <ResizableHandle className="w-px bg-white/10 hover:bg-cyan-500/30 transition-colors" />

            {/* Active chat panel */}
            <ResizablePanel defaultSize={75} minSize={50}>
              <ActiveChatPanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}

export default Home
