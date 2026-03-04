import { useEffect, useState, useCallback } from 'react'
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
import { Loader2, Trash2, Wifi, Users, Key, Link, LogOut } from 'lucide-react'
import { adminFetch, getNostrPublicKey } from '@/lib/nostr-auth'

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
  avatar_url: string | null
  oauth_provider: string
  created_at: number
}

interface Assignment {
  id: string
  user_id: string
  identity_id: string
  user_email: string | null
  identity_pubkey: string | null
  identity_label: string | null
  expires_at: number
  created_at: number
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

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const NAV_ITEMS: { key: Section; label: string; icon: typeof Wifi }[] = [
  { key: 'sessions', label: 'Sessions', icon: Wifi },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'keys', label: 'Secret Keys', icon: Key },
  { key: 'assignments', label: 'Assignments', icon: Link },
]

export default function Admin() {
  const [authState, setAuthState] = useState<'loading' | 'no-extension' | 'connect' | 'unauthorized' | 'authenticated'>('loading')
  const [adminPubkey, setAdminPubkey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [activeSection, setActiveSection] = useState<Section>('sessions')

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
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Check for NIP-07 extension on mount
  useEffect(() => {
    if (!window.nostr) {
      setAuthState('no-extension')
      return
    }
    setAuthState('connect')
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
    } catch {
      // best-effort
    }
  }, [])

  const fetchIdentities = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/identities')
      if (!res.ok) throw new Error('Failed to fetch identities')
      setIdentities(await res.json())
    } catch {
      // best-effort
    }
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      setUsers(await res.json())
    } catch {
      // best-effort
    }
  }, [])

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/assignments')
      if (!res.ok) throw new Error('Failed to fetch assignments')
      setAssignments(await res.json())
    } catch {
      // best-effort
    }
  }, [])

  // Fetch data when section changes or auth succeeds
  useEffect(() => {
    if (authState !== 'authenticated') return
    setDataLoading(true)
    const fetchMap: Record<Section, () => Promise<void>> = {
      sessions: fetchConnections,
      users: fetchUsers,
      keys: fetchIdentities,
      assignments: async () => {
        await Promise.all([fetchAssignments(), fetchUsers(), fetchIdentities()])
      },
    }
    fetchMap[activeSection]().finally(() => setDataLoading(false))
  }, [authState, activeSection, fetchConnections, fetchUsers, fetchIdentities, fetchAssignments])

  const handleRevokeConnection = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/connections/${id}`, 'DELETE')
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id))
      }
    } catch {
      // user can retry
    }
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
      if (res.ok) {
        setIdentities((prev) => prev.filter((i) => i.id !== id))
      }
    } catch {
      // user can retry
    }
  }

  const handleCreateAssignment = async () => {
    setAssignLoading(true)
    setAssignError(null)
    try {
      const res = await adminFetch('/api/admin/assignments', 'POST', {
        user_id: selectedUserId,
        identity_id: selectedIdentityId,
        duration: selectedDuration,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create assignment')
      }
      setSelectedUserId('')
      setSelectedIdentityId('')
      setSelectedDuration('')
      await fetchAssignments()
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setAssignLoading(false)
    }
  }

  const handleDeleteAssignment = async (id: string) => {
    try {
      const res = await adminFetch(`/api/admin/assignments/${id}`, 'DELETE')
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== id))
      }
    } catch {
      // user can retry
    }
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

  // --- Auth gate screens (unchanged) ---

  if (authState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (authState === 'no-extension') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-[500px]">
          <CardHeader>
            <CardTitle>Nostr Extension Required</CardTitle>
            <CardDescription>
              Install a NIP-07 browser extension (like nos2x or Alby) to access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authState === 'connect') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-[500px]">
          <CardHeader>
            <CardTitle>Admin Panel</CardTitle>
            <CardDescription>
              Connect with your Nostr identity to access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleConnect}>
              Connect with Nostr
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (authState === 'unauthorized') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-[500px]">
          <CardHeader>
            <CardTitle>Not Authorized</CardTitle>
            <CardDescription>
              Your pubkey ({adminPubkey ? truncate(adminPubkey, 20) : 'unknown'}) is not in the admin allowlist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => { setAuthState('connect'); setError(null) }}>
              Try Another Key
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Authenticated: sidebar + content layout ---

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-[200px] shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Admin</h2>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                activeSection === key
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="px-2 pb-4">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        {dataLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {activeSection === 'sessions' && <SessionsTable connections={connections} onRevoke={handleRevokeConnection} />}
            {activeSection === 'users' && <UsersTable users={users} />}
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
                assignLoading={assignLoading}
                assignError={assignError}
                onUserChange={setSelectedUserId}
                onIdentityChange={setSelectedIdentityId}
                onDurationChange={setSelectedDuration}
                onCreate={handleCreateAssignment}
                onDelete={handleDeleteAssignment}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

// --- Section components ---

function SessionsTable({ connections, onRevoke }: { connections: Connection[]; onRevoke: (id: string) => void }) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Sessions</h1>
      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Identity</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Relay</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {connections.map((conn) => (
              <TableRow key={conn.id}>
                <TableCell className="text-sm">{conn.user_email || truncate(conn.user_id)}</TableCell>
                <TableCell className="text-sm font-mono">
                  {conn.identity_label || (conn.identity_pubkey ? truncate(conn.identity_pubkey) : '—')}
                </TableCell>
                <TableCell className="text-sm font-mono">{truncate(conn.client_pubkey)}</TableCell>
                <TableCell className="text-sm">{conn.relay_url}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{relativeTime(conn.last_used_at)}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="icon" className="h-8 w-8">
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
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function UsersTable({ users }: { users: User[] }) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Users</h1>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No registered users.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Avatar</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-muted" />
                  )}
                </TableCell>
                <TableCell className="text-sm">{user.email || 'No email'}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">{user.oauth_provider}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(user.created_at * 1000).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
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
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Secret Keys</h1>

      {/* Add identity inline form */}
      <div className="flex items-end gap-3 mb-6">
        <div className="space-y-1">
          <Label htmlFor="nsec" className="text-xs">nsec</Label>
          <Input
            id="nsec"
            type="password"
            placeholder="nsec1..."
            value={nsecInput}
            onChange={(e) => onNsecChange(e.target.value)}
            className="w-[280px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="label" className="text-xs">Label</Label>
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
          Add
        </Button>
        {addError && <p className="text-sm text-destructive">{addError}</p>}
      </div>

      {identities.length === 0 ? (
        <p className="text-sm text-muted-foreground">No identities in the pool.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pubkey</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Connections</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {identities.map((identity) => (
              <TableRow key={identity.id}>
                <TableCell className="text-sm font-mono">{truncate(identity.pubkey, 24)}</TableCell>
                <TableCell className="text-sm">{identity.label || '—'}</TableCell>
                <TableCell className="text-sm">{identity.active_connections}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="icon" className="h-8 w-8">
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
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function AssignmentsSection({
  assignments,
  users,
  identities,
  selectedUserId,
  selectedIdentityId,
  selectedDuration,
  assignLoading,
  assignError,
  onUserChange,
  onIdentityChange,
  onDurationChange,
  onCreate,
  onDelete,
}: {
  assignments: Assignment[]
  users: User[]
  identities: Identity[]
  selectedUserId: string
  selectedIdentityId: string
  selectedDuration: string
  assignLoading: boolean
  assignError: string | null
  onUserChange: (v: string) => void
  onIdentityChange: (v: string) => void
  onDurationChange: (v: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Assignments</h1>

      {/* New assignment inline form */}
      <div className="flex items-end gap-3 mb-6 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs">User</Label>
          <Select value={selectedUserId} onValueChange={onUserChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.email || truncate(user.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Identity</Label>
          <Select value={selectedIdentityId} onValueChange={onIdentityChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select identity" />
            </SelectTrigger>
            <SelectContent>
              {identities.map((identity) => (
                <SelectItem key={identity.id} value={identity.id}>
                  {identity.label
                    ? `${identity.label} (${truncate(identity.pubkey)})`
                    : truncate(identity.pubkey, 24)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duration</Label>
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

      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assignments.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Identity</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assignments.map((assignment) => {
              const isExpired = assignment.expires_at * 1000 < Date.now()
              return (
                <TableRow key={assignment.id}>
                  <TableCell className="text-sm">
                    {assignment.user_email || truncate(assignment.user_id)}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {assignment.identity_label || truncate(assignment.identity_pubkey || '', 24)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(assignment.expires_at * 1000).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isExpired ? 'destructive' : 'secondary'} className="text-xs">
                      {isExpired ? 'Expired' : 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="icon" className="h-8 w-8">
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
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
