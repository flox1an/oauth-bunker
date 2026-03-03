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
import { Copy, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

interface UserInfo {
  pubkey: string
  npub: string
  oauth_provider: string
  created_at: number
}

interface Connection {
  id: string
  client_pubkey: string
  relay_url: string
  created_at: number
  last_used_at: number
}

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function truncate(str: string, len: number = 16): string {
  if (str.length <= len) return str
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  )
}

export default function Dashboard() {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [nsecInput, setNsecInput] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const connectionDomain = window.location.host

  const fetchData = useCallback(async () => {
    try {
      const [meRes, connRes] = await Promise.all([
        fetch('/api/me'),
        fetch('/api/connections'),
      ])

      if (meRes.status === 401) {
        window.location.href = '/'
        return
      }

      if (!meRes.ok || !connRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const meData = await meRes.json()
      const connData = await connRes.json()

      setUser(meData)
      setConnections(connData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id))
      }
    } catch {
      // Silently fail; user can retry
    }
  }

  const handleImportKey = async () => {
    setImportLoading(true)
    setImportError(null)
    try {
      const res = await fetch('/api/import-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nsec: nsecInput }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to import key')
      }
      setNsecInput('')
      setImportOpen(false)
      await fetchData()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImportLoading(false)
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
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

        {/* Your Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Your Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="w-20 shrink-0 text-muted-foreground">npub</Label>
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                {user?.npub}
              </code>
              <CopyButton text={user?.npub ?? ''} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="w-20 shrink-0 text-muted-foreground">Provider</Label>
              <Badge variant="secondary">{user?.oauth_provider}</Badge>
            </div>
          </CardContent>
        </Card>

        {/* Connection Info */}
        <Card>
          <CardHeader>
            <CardTitle>Connect from any Nostr client</CardTitle>
            <CardDescription>
              Enter this domain in any NIP-46 compatible Nostr client to connect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                {connectionDomain}
              </code>
              <CopyButton text={connectionDomain} />
            </div>
          </CardContent>
        </Card>

        {/* Connected Apps */}
        <Card>
          <CardHeader>
            <CardTitle>Connected Apps</CardTitle>
            <CardDescription>
              {connections.length === 0
                ? 'No active connections.'
                : `${connections.length} active connection${connections.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </CardHeader>
          {connections.length > 0 && (
            <CardContent className="space-y-3">
              {connections.map((conn, i) => (
                <div key={conn.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-mono">
                        {truncate(conn.client_pubkey, 24)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conn.relay_url} -- last used {relativeTime(conn.last_used_at)}
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm">
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke connection?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will disconnect the client. They will need to re-authenticate to
                            connect again.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRevoke(conn.id)}>
                            Revoke
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

        {/* Import Key */}
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setImportOpen(!importOpen)}
          >
            <div className="flex items-center gap-2">
              {importOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <CardTitle>Import Key</CardTitle>
            </div>
          </CardHeader>
          {importOpen && (
            <CardContent className="space-y-4">
              <p className="text-sm text-destructive">
                Warning: Importing a key will replace your current Nostr identity. This action
                cannot be undone.
              </p>
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
              {importError && (
                <p className="text-sm text-destructive">{importError}</p>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!nsecInput.startsWith('nsec1') || importLoading}>
                    {importLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Import Key
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Replace your Nostr key?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently replace your current Nostr identity with the imported
                      key. All existing connections will continue to work with the new key.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleImportKey}>
                      Replace Key
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
