import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { SimplePool, nip19 } from 'nostr-tools'

const PROFILE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nsec.app',
]

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
  created_by_avatar: string | null
  is_own: boolean
  identity_pubkey: string | null
  identity_label: string | null
}

interface NostrProfile {
  name?: string
  display_name?: string
  picture?: string
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
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({})
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
      const connData: Connection[] = await connRes.json()

      setUser(meData)
      setConnections(connData)

      // Fetch Nostr profiles for assigned identities
      const pubkeys = [...new Set(connData.map((c) => c.identity_pubkey).filter(Boolean))] as string[]
      if (pubkeys.length > 0) {
        const pool = new SimplePool()
        try {
          const events = await pool.querySync(PROFILE_RELAYS, {
            kinds: [0],
            authors: pubkeys,
          })
          const profileMap: Record<string, NostrProfile> = {}
          for (const event of events) {
            if (!profileMap[event.pubkey]) {
              try {
                profileMap[event.pubkey] = JSON.parse(event.content)
              } catch {
                // Invalid JSON, skip
              }
            }
          }
          setProfiles(profileMap)
        } catch {
          // Profile fetch is best-effort
        }
      }
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
            <CardContent className="space-y-2">
              {connections.map((conn) => {
                const profile = conn.identity_pubkey ? profiles[conn.identity_pubkey] : undefined
                const identityName = profile?.display_name || profile?.name || conn.identity_label || null
                const profileAvatar = profile?.picture
                const oauthAvatar = conn.created_by_avatar

                return (
                  <div
                    key={conn.id}
                    className="flex items-center gap-3 rounded-lg border p-3"
                  >
                    {/* Identity/profile avatar */}
                    {profileAvatar ? (
                      <img
                        src={profileAvatar}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
                    )}

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {identityName ? (
                          <p className="truncate text-sm font-medium">{identityName}</p>
                        ) : conn.identity_pubkey ? (
                          <p className="truncate text-sm font-mono text-muted-foreground">
                            {truncate(nip19.npubEncode(conn.identity_pubkey), 20)}
                          </p>
                        ) : null}
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {conn.oauth_provider}
                        </Badge>
                      </div>
                      {conn.created_by_email && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">used by</span>
                          {oauthAvatar ? (
                            <img
                              src={oauthAvatar}
                              alt=""
                              className="h-4 w-4 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <div className="h-4 w-4 shrink-0 rounded-full bg-muted" />
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {conn.created_by_email}
                          </p>
                        </div>
                      )}
                      <p className="truncate text-xs text-muted-foreground font-mono">
                        {truncate(nip19.npubEncode(conn.client_pubkey), 24)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        last used {relativeTime(conn.last_used_at)}
                      </p>
                    </div>

                    {/* Revoke */}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="shrink-0 text-destructive hover:text-destructive">
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
                )
              })}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
