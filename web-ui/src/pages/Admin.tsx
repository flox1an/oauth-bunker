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
import { Loader2, Trash2 } from 'lucide-react'

interface Identity {
  id: string
  pubkey: string
  label: string | null
  created_at: number
  active_connections: number
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

  useEffect(() => {
    fetchIdentities()
  }, [fetchIdentities])

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
      </div>
    </div>
  )
}
