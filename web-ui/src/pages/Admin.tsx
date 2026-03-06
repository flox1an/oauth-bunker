import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Loader2, Trash2, Wifi, Users, Key, Link, LogOut, Sun, Moon, Shield, Zap, Copy, Check } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEventModel } from 'applesauce-react/hooks'
import { ProfileModel } from 'applesauce-core/models'
import type { ProfileContent } from 'applesauce-core/helpers'
import { requestProfiles } from '@/lib/nostr-profiles'
import { adminFetch, getNostrPublicKey } from '@/lib/nostr-auth'

/** Request profiles on mount/change; data comes reactively via useProfile */
function useRequestProfiles(pubkeys: string[]) {
  const key = useMemo(() => [...pubkeys].sort().join(','), [pubkeys])
  const requested = useRef<string>('')
  useEffect(() => {
    if (key && key !== requested.current) {
      requested.current = key
      requestProfiles(pubkeys)
    }
  }, [key])
}

/** Reactive profile for a single pubkey, backed by applesauce EventStore */
function useProfile(pubkey: string | null | undefined): ProfileContent | undefined {
  return useEventModel(ProfileModel, pubkey ? [pubkey] : null)
}

interface Identity {
  id: string
  pubkey: string
  label: string | null
  created_at: number
  active_connections: number
}

interface User {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  oauth_provider: string
  oauth_sub: string
  created_at: number
}

interface Assignment {
  id: string
  user_id: string
  identity_id: string
  user_email: string | null
  identity_pubkey: string | null
  identity_label: string | null
  allowed_kinds: number[] | null
  expires_at: number
  created_at: number
}

const KIND_PRESETS = [
  { label: 'Social notes', kinds: [1, 1111], default: true },
  { label: 'Reactions', kinds: [7], default: true },
  { label: 'Reposts', kinds: [6], default: true },
  { label: 'Zaps', kinds: [9734], default: false },
  { label: 'Articles', kinds: [30023, 30024, 9802], default: false },
  { label: 'Videos', kinds: [21, 22, 34235, 34236, 30311], default: false },
  { label: 'DMs', kinds: [4, 14, 1059], default: false },
  { label: 'Profile updates', kinds: [0], default: false },
  { label: 'Lists', kinds: [30000, 30001, 30003], default: false },
  { label: 'Files', kinds: [24242, 27235], default: false },
] as const

function kindsToPresetLabels(kinds: number[]): string[] {
  const labels: string[] = []
  for (const preset of KIND_PRESETS) {
    if (preset.kinds.every((k) => kinds.includes(k))) {
      labels.push(preset.label)
    }
  }
  return labels
}

interface Connection {
  id: string
  user_id: string
  client_pubkey: string
  relay_url: string
  created_at: number
  last_used_at: number
  identity_pubkey: string | null
  identity_label: string | null
  user_email: string | null
}

type Section = 'sessions' | 'users' | 'keys' | 'assignments'

function truncate(str: string, len: number = 16): string {
  if (str.length <= len) return str
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2)
}

function ProfileAvatar({ picture, fallbackIcon: Icon = Key }: { picture?: string; fallbackIcon?: typeof Key }) {
  return picture ? (
    <img src={picture} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-border shrink-0" />
  ) : (
    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
      <Icon className="h-3.5 w-3.5 text-primary/60" />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={handleCopy}
      className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors cursor-pointer"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const NAV_ITEMS: { key: Section; label: string; icon: typeof Wifi }[] = [
  { key: 'keys', label: 'Secret Keys', icon: Key },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'assignments', label: 'Assignments', icon: Link },
  { key: 'sessions', label: 'Sessions', icon: Wifi },
]

// ---------------------------------------------------------------------------
// Theme toggle hook
// ---------------------------------------------------------------------------

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  const toggle = useCallback(() => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'light') {
      setDark(false)
      document.documentElement.classList.remove('dark')
    } else {
      setDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  return { dark, toggle }
}

// ---------------------------------------------------------------------------
// Stat card component
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Wifi }) {
  return (
    <div className="stat-card border border-border p-4">
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold mt-1 tracking-tight">{value}</p>
        </div>
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Admin component
// ---------------------------------------------------------------------------

export default function Admin() {
  const { dark, toggle: toggleTheme } = useTheme()
  const [authState, setAuthState] = useState<'loading' | 'no-extension' | 'connect' | 'unauthorized' | 'authenticated'>('loading')
  const [adminPubkey, setAdminPubkey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch admin's nostr profile for sidebar display
  useRequestProfiles(adminPubkey ? [adminPubkey] : [])
  const adminProfile = useProfile(adminPubkey)

  const [activeSection, setActiveSection] = useState<Section>('keys')

  // Data states
  const [connections, setConnections] = useState<Connection[]>([])
  const [identities, setIdentities] = useState<Identity[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  // Add identity form
  const [nsecInput, setNsecInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Assignment form state
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedIdentityId, setSelectedIdentityId] = useState('')
  const [selectedDuration, setSelectedDuration] = useState('')
  const [selectedKindPresets, setSelectedKindPresets] = useState<string[]>(
    KIND_PRESETS.filter((p) => p.default).map((p) => p.label)
  )
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Check for NIP-07 extension on mount
  useEffect(() => {
    if (window.nostr) {
      setAuthState('connect')
      return
    }
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (window.nostr) {
        clearInterval(interval)
        setAuthState('connect')
      } else if (attempts >= 20) {
        clearInterval(interval)
        setAuthState('no-extension')
      }
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const handleConnect = async () => {
    try {
      const pubkey = await getNostrPublicKey()
      if (!pubkey) {
        setAuthState('no-extension')
        return
      }
      setAdminPubkey(pubkey)
      const res = await adminFetch('/api/admin/identities')
      if (res.status === 401 || res.status === 403) {
        setAuthState('unauthorized')
        return
      }
      if (!res.ok) {
        setError('Failed to authenticate')
        return
      }
      const data = await res.json()
      setIdentities(data)
      setAuthState('authenticated')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed')
      setAuthState('connect')
    }
  }

  const fetchConnections = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/connections')
      if (!res.ok) throw new Error('Failed to fetch connections')
      setConnections(await res.json())
    } catch { /* best-effort */ }
  }, [])

  const fetchIdentities = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/identities')
      if (!res.ok) throw new Error('Failed to fetch identities')
      setIdentities(await res.json())
    } catch { /* best-effort */ }
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      setUsers(await res.json())
    } catch { /* best-effort */ }
  }, [])

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/assignments')
      if (!res.ok) throw new Error('Failed to fetch assignments')
      setAssignments(await res.json())
    } catch { /* best-effort */ }
  }, [])

  const fetchConfig = useCallback(async () => {
    // Config fetch reserved for future use
  }, [])

  // Fetch all stats on initial auth
  useEffect(() => {
    if (authState !== 'authenticated') return
    Promise.all([fetchConnections(), fetchUsers(), fetchIdentities(), fetchAssignments(), fetchConfig()]).catch(() => {})
  }, [authState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch section-specific data when tab changes
  useEffect(() => {
    if (authState !== 'authenticated') return
    setDataLoading(true)
    const fetchMap: Record<Section, () => Promise<void>> = {
      sessions: fetchConnections,
      users: fetchUsers,
      keys: fetchIdentities,
      assignments: async () => {
        await Promise.all([fetchAssignments(), fetchUsers(), fetchIdentities(), fetchConfig()])
      },
    }
    fetchMap[activeSection]().finally(() => setDataLoading(false))
  }, [authState, activeSection, fetchConnections, fetchUsers, fetchIdentities, fetchAssignments, fetchConfig])

  const handleRevokeConnection = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/connections/${id}`, 'DELETE')
      if (res.ok) setConnections((prev) => prev.filter((c) => c.id !== id))
    } catch { /* user can retry */ }
  }

  const handleAddIdentity = async () => {
    setAddLoading(true)
    setAddError(null)
    try {
      const body: { nsec: string; label?: string } = { nsec: nsecInput }
      if (labelInput.trim()) body.label = labelInput.trim()
      const res = await adminFetch('/api/admin/identities', 'POST', body)
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add identity')
      }
      setNsecInput('')
      setLabelInput('')
      await fetchIdentities()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setAddLoading(false)
    }
  }

  const handleDeleteIdentity = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/identities/${id}`, 'DELETE')
      if (res.ok) setIdentities((prev) => prev.filter((i) => i.id !== id))
    } catch { /* user can retry */ }
  }

  const handleCreateAssignment = async () => {
    setAssignLoading(true)
    setAssignError(null)
    try {
      const allowedKinds = KIND_PRESETS
        .filter((p) => selectedKindPresets.includes(p.label))
        .flatMap((p) => [...p.kinds])
      const res = await adminFetch('/api/admin/assignments', 'POST', {
        user_id: selectedUserId,
        identity_id: selectedIdentityId,
        duration: selectedDuration,
        allowed_kinds: allowedKinds.length > 0 ? allowedKinds : null,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create assignment')
      }
      setSelectedUserId('')
      setSelectedIdentityId('')
      setSelectedDuration('')
      setSelectedKindPresets(KIND_PRESETS.filter((p) => p.default).map((p) => p.label))
      await fetchAssignments()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setAssignLoading(false)
    }
  }

  const handleDeleteUser = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/users/${id}`, 'DELETE')
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id))
        // Also remove related assignments and connections from local state
        setAssignments((prev) => prev.filter((a) => a.user_id !== id))
        setConnections((prev) => prev.filter((c) => c.user_id !== id))
      }
    } catch { /* user can retry */ }
  }

  const handleDeleteAssignment = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/assignments/${id}`, 'DELETE')
      if (res.ok) setAssignments((prev) => prev.filter((a) => a.id !== id))
    } catch { /* user can retry */ }
  }

  const handleLogout = () => {
    setAuthState('connect')
    setAdminPubkey(null)
    setError(null)
    setConnections([])
    setIdentities([])
    setUsers([])
    setAssignments([])
    setActiveSection('sessions')
  }

  // --- Auth gate screens ---

  if (authState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center grid-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (authState === 'no-extension') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 grid-bg">
        <Card className="w-full max-w-[460px] border-border/50 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-xl tracking-tight">Extension Required</CardTitle>
            <CardDescription className="text-sm">
              Install a NIP-07 browser extension (nos2x, Alby, etc.) to access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 flex justify-center">
            <Button variant="outline" onClick={() => window.location.reload()} className="px-6">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authState === 'connect') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 grid-bg">
        <Card className="w-full max-w-[460px] border-border/50 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-xl tracking-tight">Nostr Signer Admin</CardTitle>
            <CardDescription className="text-sm">
              Authenticate with your Nostr identity to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2 flex flex-col items-center">
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button onClick={handleConnect} className="px-8 font-medium">
              Connect with Nostr
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authState === 'unauthorized') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 grid-bg">
        <Card className="w-full max-w-[460px] border-border/50 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
              <Shield className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle className="text-xl tracking-tight">Not Authorized</CardTitle>
            <CardDescription className="text-sm">
              <span className="font-mono text-xs">{adminPubkey ? truncate(nip19.npubEncode(adminPubkey), 20) : 'unknown'}</span> is not in the admin allowlist.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 flex justify-center">
            <Button variant="outline" onClick={() => { setAuthState('connect'); setError(null) }} className="px-6">
              Try Another Key
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Authenticated layout ---

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-[220px] shrink-0 border-r border-border glass-sidebar flex flex-col">
        <div className="p-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Signer Admin</h2>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">Control Panel</p>
            </div>
          </div>
        </div>

        <div className="glow-line mx-4 mb-3 opacity-50" />

        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer transition-all duration-200 ${
                activeSection === key
                  ? 'nav-active font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-3 space-y-1">
          <div className="glow-line mx-1 mb-2 opacity-30" />
          {adminPubkey && (
            <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
              <ProfileAvatar picture={adminProfile?.picture} fallbackIcon={Shield} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {adminProfile?.display_name || adminProfile?.name || truncate(nip19.npubEncode(adminPubkey), 16)}
                </p>
                <p className="truncate text-[10px] text-muted-foreground font-mono">
                  {truncate(nip19.npubEncode(adminPubkey), 16)}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-200"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all duration-200"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto grid-bg">
        {/* Stat bar */}
        <div className="p-6 pb-0">
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Identities" value={identities.length} icon={Key} />
            <StatCard label="Users" value={users.length} icon={Users} />
            <StatCard label="Assignments" value={assignments.length} icon={Link} />
            <StatCard label="Sessions" value={connections.length} icon={Wifi} />
          </div>
        </div>

        <div className="p-6">
          {dataLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
            </div>
          ) : (
            <>
              {activeSection === 'sessions' && <SessionsTable connections={connections} users={users} onRevoke={handleRevokeConnection} />}
              {activeSection === 'users' && <UsersTable users={users} onDelete={handleDeleteUser} />}
              {activeSection === 'keys' && (
                <KeysSection
                  identities={identities}
                  nsecInput={nsecInput}
                  labelInput={labelInput}
                  addLoading={addLoading}
                  addError={addError}
                  onNsecChange={setNsecInput}
                  onLabelChange={setLabelInput}
                  onAdd={handleAddIdentity}
                  onDelete={handleDeleteIdentity}
                />
              )}
              {activeSection === 'assignments' && (
                <AssignmentsSection
                  assignments={assignments}
                  users={users}
                  identities={identities}

                  selectedUserId={selectedUserId}
                  selectedIdentityId={selectedIdentityId}
                  selectedDuration={selectedDuration}
                  selectedKindPresets={selectedKindPresets}
                  assignLoading={assignLoading}
                  assignError={assignError}
                  onUserChange={setSelectedUserId}
                  onIdentityChange={setSelectedIdentityId}
                  onDurationChange={setSelectedDuration}
                  onKindPresetsChange={setSelectedKindPresets}
                  onCreate={handleCreateAssignment}
                  onDelete={handleDeleteAssignment}
                />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-lg font-semibold tracking-tight">{children}</h1>
      <div className="glow-line mt-2 opacity-40" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function SessionsTable({ connections, users, onRevoke }: { connections: Connection[]; users: User[]; onRevoke: (id: string) => void }) {
  const allPubkeys = useMemo(() => {
    const set = new Set<string>()
    for (const c of connections) {
      set.add(c.client_pubkey)
      if (c.identity_pubkey) set.add(c.identity_pubkey)
    }
    return [...set]
  }, [connections])
  useRequestProfiles(allPubkeys)

  return (
    <div>
      <SectionHeading>Sessions</SectionHeading>
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold text-xs uppercase tracking-wider">User</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Identity</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Client</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Relay</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Last Used</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((conn) => (
                <SessionRow key={conn.id} conn={conn} user={users.find((u) => u.id === conn.user_id)} onRevoke={onRevoke} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function SessionRow({ conn, user, onRevoke }: { conn: Connection; user?: User; onRevoke: (id: string) => void }) {
  const clientProfile = useProfile(conn.client_pubkey)
  const identityProfile = useProfile(conn.identity_pubkey)
  const isNostr = user?.oauth_provider === 'nostr'
  const userNostrProfile = useProfile(isNostr ? user.oauth_sub : null)
  const clientName = clientProfile?.display_name || clientProfile?.name
  const npub = conn.identity_pubkey ? nip19.npubEncode(conn.identity_pubkey) : null

  const userAvatar = user?.avatar_url || userNostrProfile?.picture
  const userName = user?.display_name || userNostrProfile?.display_name || userNostrProfile?.name || conn.user_email || truncate(conn.user_id)

  return (
    <TableRow className="hover:bg-accent/30 transition-colors">
      <TableCell>
        <div className="flex items-center gap-2">
          {userAvatar ? (
            <img src={userAvatar} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-border shrink-0" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Users className="h-3.5 w-3.5 text-primary/60" />
            </div>
          )}
          <span className="text-sm">{userName}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <ProfileAvatar picture={identityProfile?.picture} fallbackIcon={Key} />
          <span className="text-sm font-mono text-primary/80">
            {npub ? truncate(npub, 24) : '\u2014'}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {clientProfile?.picture && (
            <img src={clientProfile.picture} alt="" className="h-7 w-7 rounded-full object-cover ring-1 ring-border" />
          )}
          <span className={clientName ? 'text-sm' : 'text-sm font-mono'}>
            {clientName || truncate(nip19.npubEncode(conn.client_pubkey))}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{conn.relay_url}</TableCell>
      <TableCell className="text-sm text-muted-foreground">{relativeTime(conn.last_used_at)}</TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke session?</AlertDialogTitle>
              <AlertDialogDescription>
                This will disconnect the client immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRevoke(conn.id)}>
                Revoke
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

function UsersTable({ users, onDelete }: { users: User[]; onDelete: (id: string) => void }) {
  const nostrPubkeys = useMemo(
    () => users.filter((u) => u.oauth_provider === 'nostr').map((u) => u.oauth_sub),
    [users],
  )
  useRequestProfiles(nostrPubkeys)

  return (
    <div>
      <SectionHeading>Users</SectionHeading>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No registered users.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-[50px]"></TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Username</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Email</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Provider</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Joined</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} onDelete={onDelete} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function UserRow({ user, onDelete }: { user: User; onDelete: (id: string) => void }) {
  const isNostr = user.oauth_provider === 'nostr'
  const nostrProfile = useProfile(isNostr ? user.oauth_sub : null)

  const avatarUrl = user.avatar_url || nostrProfile?.picture
  const displayName = user.display_name || nostrProfile?.display_name || nostrProfile?.name || (isNostr ? truncate(nip19.npubEncode(user.oauth_sub), 20) : null)

  return (
    <TableRow className="hover:bg-accent/30 transition-colors">
      <TableCell>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full ring-1 ring-border object-cover" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Users className="h-3.5 w-3.5 text-primary/60" />
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm">{displayName || '\u2014'}</TableCell>
      <TableCell className="text-sm">{user.email || '\u2014'}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs font-mono">{user.oauth_provider}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(user.created_at * 1000).toLocaleDateString()}
      </TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete user?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the user and all their sessions, assignments, and connections.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(user.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

function UserSelectOption({ user }: { user: User }) {
  const isNostr = user.oauth_provider === 'nostr'
  const nostrProfile = useProfile(isNostr ? user.oauth_sub : null)
  const avatarUrl = user.avatar_url || nostrProfile?.picture
  const label = user.email || user.display_name || nostrProfile?.display_name || nostrProfile?.name || (isNostr ? truncate(nip19.npubEncode(user.oauth_sub), 20) : truncate(user.id))

  return (
    <SelectItem value={user.id}>
      <span className="flex items-center gap-2">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-5 w-5 rounded-full shrink-0" />
        ) : (
          <span className="h-5 w-5 rounded-full bg-primary/10 shrink-0 inline-flex items-center justify-center">
            <Users className="h-3 w-3 text-primary/60" />
          </span>
        )}
        {label + ` (${user.oauth_provider})`}
      </span>
    </SelectItem>
  )
}

function KeysSection({
  identities,
  nsecInput,
  labelInput,
  addLoading,
  addError,
  onNsecChange,
  onLabelChange,
  onAdd,
  onDelete,
}: {
  identities: Identity[]
  nsecInput: string
  labelInput: string
  addLoading: boolean
  addError: string | null
  onNsecChange: (v: string) => void
  onLabelChange: (v: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
}) {
  const identityPubkeys = useMemo(() => identities.map((i) => i.pubkey), [identities])
  useRequestProfiles(identityPubkeys)

  return (
    <div>
      <SectionHeading>Secret Keys</SectionHeading>

      <div className="flex items-end gap-3 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="nsec" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">nsec</Label>
          <Input
            id="nsec"
            type="password"
            placeholder="nsec1..."
            value={nsecInput}
            onChange={(e) => onNsecChange(e.target.value)}
            className="w-[280px] font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Label</Label>
          <Input
            id="label"
            type="text"
            placeholder="optional"
            value={labelInput}
            onChange={(e) => onLabelChange(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <Button
          onClick={onAdd}
          disabled={!nsecInput.startsWith('nsec1') || addLoading}
          size="sm"
        >
          {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add Key
        </Button>
        {addError && <p className="text-sm text-destructive">{addError}</p>}
      </div>

      {identities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No identities in the pool.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Identity</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Label</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Connections</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {identities.map((identity) => (
                <KeyRow key={identity.id} identity={identity} onDelete={onDelete} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function KeyRow({ identity, onDelete }: { identity: Identity; onDelete: (id: string) => void }) {
  const profile = useProfile(identity.pubkey)
  const npub = nip19.npubEncode(identity.pubkey)

  return (
    <TableRow className="hover:bg-accent/30 transition-colors">
      <TableCell>
        <div className="flex items-center gap-2.5">
          <ProfileAvatar picture={profile?.picture} />
          <span className="text-sm font-mono text-primary/80">{truncate(npub, 24)}</span>
          <CopyButton text={npub} />
        </div>
      </TableCell>
      <TableCell className="text-sm">{identity.label || '\u2014'}</TableCell>
      <TableCell>
        <span className="inline-flex items-center justify-center h-6 min-w-[24px] rounded-md bg-primary/10 text-primary text-xs font-semibold px-1.5">
          {identity.active_connections}
        </span>
      </TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete identity?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the identity from the pool. All connections using this identity will stop working.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(identity.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}

function AssignmentsSection({
  assignments,
  users,
  identities,
  selectedUserId,
  selectedIdentityId,
  selectedDuration,
  selectedKindPresets,
  assignLoading,
  assignError,
  onUserChange,
  onIdentityChange,
  onDurationChange,
  onKindPresetsChange,
  onCreate,
  onDelete,
}: {
  assignments: Assignment[]
  users: User[]
  identities: Identity[]
  selectedUserId: string
  selectedIdentityId: string
  selectedDuration: string
  selectedKindPresets: string[]
  assignLoading: boolean
  assignError: string | null
  onUserChange: (v: string) => void
  onIdentityChange: (v: string) => void
  onDurationChange: (v: string) => void
  onKindPresetsChange: (v: string[]) => void
  onCreate: () => void
  onDelete: (id: string) => void
}) {
  const identityPubkeys = useMemo(
    () => [...new Set(assignments.map((a) => a.identity_pubkey).filter(Boolean) as string[])],
    [assignments],
  )
  useRequestProfiles(identityPubkeys)
  const nostrUserPubkeys = useMemo(
    () => users.filter((u) => u.oauth_provider === 'nostr').map((u) => u.oauth_sub),
    [users],
  )
  useRequestProfiles(nostrUserPubkeys)

  const togglePreset = (label: string) => {
    onKindPresetsChange(
      selectedKindPresets.includes(label)
        ? selectedKindPresets.filter((l) => l !== label)
        : [...selectedKindPresets, label]
    )
  }

  return (
    <div>
      <SectionHeading>Assignments</SectionHeading>

      {/* Form */}
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">User</Label>
          <Select value={selectedUserId} onValueChange={onUserChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <UserSelectOption key={user.id} user={user} />
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Identity</Label>
          <Select value={selectedIdentityId} onValueChange={onIdentityChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select identity" />
            </SelectTrigger>
            <SelectContent>
              {identities.map((identity) => (
                <SelectItem key={identity.id} value={identity.id}>
                  {identity.label
                    ? `${identity.label} (${truncate(nip19.npubEncode(identity.pubkey))})`
                    : truncate(nip19.npubEncode(identity.pubkey), 24)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Duration</Label>
          <Select value={selectedDuration} onValueChange={onDurationChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1d">1 Day</SelectItem>
              <SelectItem value="1w">1 Week</SelectItem>
              <SelectItem value="1m">1 Month</SelectItem>
              <SelectItem value="6m">6 Months</SelectItem>
              <SelectItem value="1y">1 Year</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={onCreate}
          disabled={!selectedUserId || !selectedIdentityId || !selectedDuration || assignLoading}
          size="sm"
        >
          {assignLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Assign
        </Button>
        {assignError && <p className="text-sm text-destructive">{assignError}</p>}
      </div>

      {/* Kind presets */}
      <div className="mb-6">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block">Allowed Event Kinds</Label>
        <div className="flex flex-wrap gap-2">
          {KIND_PRESETS.map((preset) => {
            const isSelected = selectedKindPresets.includes(preset.label)
            return (
              <button
                key={preset.label}
                onClick={() => togglePreset(preset.label)}
                className={`inline-flex items-center rounded-lg border px-3 py-1 text-xs font-medium transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_12px_-3px] shadow-primary/40'
                    : 'bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                }`}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {selectedKindPresets.length === 0
            ? 'No kinds selected \u2014 all event kinds will be allowed'
            : `${selectedKindPresets.length} categor${selectedKindPresets.length === 1 ? 'y' : 'ies'} selected`}
        </p>
      </div>


      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="font-semibold text-xs uppercase tracking-wider">User</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Identity</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Allowed Kinds</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Expires</TableHead>
                <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <AssignmentRow
                  key={assignment.id}
                  assignment={assignment}
                  user={users.find((u) => u.id === assignment.user_id)}
                  onDelete={onDelete}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function AssignmentRow({ assignment, user, onDelete }: { assignment: Assignment; user?: User; onDelete: (id: string) => void }) {
  const identityProfile = useProfile(assignment.identity_pubkey)
  const isNostr = user?.oauth_provider === 'nostr'
  const userNostrProfile = useProfile(isNostr ? user.oauth_sub : null)
  const npub = assignment.identity_pubkey ? nip19.npubEncode(assignment.identity_pubkey) : null
  const isExpired = assignment.expires_at * 1000 < Date.now()
  const presetLabels = assignment.allowed_kinds
    ? kindsToPresetLabels(assignment.allowed_kinds)
    : null

  const userAvatar = user?.avatar_url || userNostrProfile?.picture
  const userName = user?.display_name || userNostrProfile?.display_name || userNostrProfile?.name || assignment.user_email || truncate(assignment.user_id)

  return (
    <TableRow className="hover:bg-accent/30 transition-colors">
      <TableCell>
        <div className="flex items-center gap-2">
          <ProfileAvatar picture={userAvatar ?? undefined} fallbackIcon={Users} />
          <span className="text-sm">{userName}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <ProfileAvatar picture={identityProfile?.picture} />
          <span className="text-sm font-mono text-primary/80">
            {npub ? truncate(npub, 24) : '\u2014'}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {presetLabels === null ? (
          <Badge variant="outline" className="text-xs border-primary/30 text-primary">All kinds</Badge>
        ) : presetLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {presetLabels.map((label) => {
              const preset = KIND_PRESETS.find((p) => p.label === label)
              const kindNumbers = preset ? preset.kinds.join(', ') : ''
              return (
                <Tooltip key={label}>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="text-xs cursor-default">
                      {label}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Kind{preset && preset.kinds.length > 1 ? 's' : ''}: {kindNumbers}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">
            {assignment.allowed_kinds?.join(', ')}
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {new Date(assignment.expires_at * 1000).toLocaleDateString()}
      </TableCell>
      <TableCell>
        {isExpired ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-xs font-medium px-2 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            Expired
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium px-2 py-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        )}
      </TableCell>
      <TableCell>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete assignment?</AlertDialogTitle>
              <AlertDialogDescription>
                This will revoke the user's access to this identity immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(assignment.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  )
}
