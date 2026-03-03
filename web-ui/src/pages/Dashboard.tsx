import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Copy, Check, Loader2 } from 'lucide-react'

interface UserInfo {
  user_id: string
  oauth_provider: string
  email: string | null
  created_at: number
  bunker_url: string
}

interface Connection {
  id: string
  client_pubkey: string
  relay_url: string
  created_at: number
  last_used_at: number
  oauth_provider: string
  oauth_sub: string
  created_by_email: string | null
  is_own: boolean
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

        {/* Connection Info */}
        <Card>
          <CardHeader>
            <CardTitle>Connect from any Nostr client</CardTitle>
            <CardDescription>
              Use the domain or bunker URL in any NIP-46 compatible Nostr client to connect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Domain</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                  {connectionDomain}
                </code>
                <CopyButton text={connectionDomain} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bunker URL</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                  {user?.bunker_url}
                </code>
                <CopyButton text={user?.bunker_url ?? ''} />
              </div>
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
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-mono">
                          {truncate(conn.client_pubkey, 24)}
                        </p>
                        <Badge variant="default" className="shrink-0 text-xs">
                          {conn.oauth_provider}
                        </Badge>
                      </div>
                      {conn.created_by_email && (
                        <p className="text-xs text-muted-foreground">
                          {conn.created_by_email}
                        </p>
                      )}
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
      </div>
    </div>
  )
}
