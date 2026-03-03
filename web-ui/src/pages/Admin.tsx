import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
import { Loader2, Trash2 } from 'lucide-react'

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

function truncate(str: string, len: number = 16): string {
  if (str.length <= len) return str
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2)
}

export default function Admin() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [nsecInput, setNsecInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [users, setUsers] = useState<User[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  // Assignment form state
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedIdentityId, setSelectedIdentityId] = useState('')
  const [selectedDuration, setSelectedDuration] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const fetchIdentities = useCallback(async () => {
    try {
      const res = await fetch('/api/identities')
      if (!res.ok) throw new Error('Failed to fetch identities')
      const data = await res.json()
      setIdentities(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      setUsers(await res.json())
    } catch {
      // Users fetch is best-effort
    }
  }, [])

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/assignments')
      if (!res.ok) throw new Error('Failed to fetch assignments')
      setAssignments(await res.json())
    } catch {
      // Assignments fetch is best-effort
    }
  }, [])

  useEffect(() => {
    fetchIdentities()
    fetchUsers()
    fetchAssignments()
  }, [fetchIdentities, fetchUsers, fetchAssignments])

  const handleAdd = async () => {
    setAddLoading(true)
    setAddError(null)
    try {
      const body: { nsec: string; label?: string } = { nsec: nsecInput }
      if (labelInput.trim()) body.label = labelInput.trim()

      const res = await fetch('/api/admin/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
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

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/identities/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setIdentities((prev) => prev.filter((i) => i.id !== id))
      }
    } catch {
      // Silently fail; user can retry
    }
  }

  const handleCreateAssignment = async () => {
    setAssignLoading(true)
    setAssignError(null)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: selectedUserId,
          identity_id: selectedIdentityId,
          duration: selectedDuration,
        }),
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
      const res = await fetch(`/api/admin/assignments/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAssignments((prev) => prev.filter((a) => a.id !== id))
      }
    } catch {
      // Silently fail; user can retry
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-[500px]">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
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

  return (
    <div className="flex min-h-screen justify-center px-4 py-8">
      <div className="w-full max-w-[600px] space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Admin — Manage Identities</h1>

        {/* Add Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Add Identity</CardTitle>
            <CardDescription>Add a Nostr identity to the pool by providing its nsec.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nsec">nsec (Nostr secret key)</Label>
              <Input
                id="nsec"
                type="password"
                placeholder="nsec1..."
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                type="text"
                placeholder="e.g. Main, Bot, Test"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
              />
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <Button
              onClick={handleAdd}
              disabled={!nsecInput.startsWith('nsec1') || addLoading}
            >
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add
            </Button>
          </CardContent>
        </Card>

        {/* Identities */}
        <Card>
          <CardHeader>
            <CardTitle>Identities</CardTitle>
            <CardDescription>
              {identities.length === 0
                ? 'No identities in the pool.'
                : `${identities.length} identit${identities.length === 1 ? 'y' : 'ies'} in the pool.`}
            </CardDescription>
          </CardHeader>
          {identities.length > 0 && (
            <CardContent className="space-y-3">
              {identities.map((identity, i) => (
                <div key={identity.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-mono">
                          {truncate(identity.pubkey, 24)}
                        </p>
                        {identity.label && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {identity.label}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {identity.active_connections} active connection{identity.active_connections === 1 ? '' : 's'}
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete identity?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the identity from the pool. All connections using this
                            identity will stop working.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(identity.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>

        {/* Users */}
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>
              {users.length === 0
                ? 'No registered users.'
                : `${users.length} registered user${users.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </CardHeader>
          {users.length > 0 && (
            <CardContent className="space-y-3">
              {users.map((user, i) => (
                <div key={user.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center gap-3">
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full"
                      />
                    ) : (
                      <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm">
                        {user.email || 'No email'}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {user.oauth_provider}
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          Joined {new Date(user.created_at * 1000).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>

        {/* Assignments */}
        <Card>
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
            <CardDescription>
              Assign identities to users with time-limited access.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* New Assignment form */}
            <div className="rounded-md border p-4 space-y-4">
              <p className="text-sm font-medium">New Assignment</p>
              <div className="space-y-2">
                <Label>User</Label>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a user" />
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
              <div className="space-y-2">
                <Label>Identity</Label>
                <Select value={selectedIdentityId} onValueChange={setSelectedIdentityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an identity" />
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
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select value={selectedDuration} onValueChange={setSelectedDuration}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select duration" />
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
              {assignError && <p className="text-sm text-destructive">{assignError}</p>}
              <Button
                onClick={handleCreateAssignment}
                disabled={!selectedUserId || !selectedIdentityId || !selectedDuration || assignLoading}
              >
                {assignLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Assign
              </Button>
            </div>

            {/* Existing assignments */}
            {assignments.length > 0 && (
              <div className="space-y-3">
                <Separator />
                {assignments.map((assignment, i) => {
                  const isExpired = assignment.expires_at * 1000 < Date.now()
                  return (
                    <div key={assignment.id}>
                      {i > 0 && <Separator className="mb-3" />}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate text-sm">
                            {assignment.user_email || truncate(assignment.user_id)}
                            {' → '}
                            {assignment.identity_label
                              ? `${assignment.identity_label} (${truncate(assignment.identity_pubkey || '')})`
                              : truncate(assignment.identity_pubkey || '', 24)}
                          </p>
                          <div className="flex items-center gap-2">
                            <p className="text-xs text-muted-foreground">
                              Expires {new Date(assignment.expires_at * 1000).toLocaleDateString()}
                            </p>
                            <Badge
                              variant={isExpired ? 'destructive' : 'secondary'}
                              className="text-xs"
                            >
                              {isExpired ? 'Expired' : 'Active'}
                            </Badge>
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0">
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
                              <AlertDialogAction onClick={() => handleDeleteAssignment(assignment.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
