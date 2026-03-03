import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SimplePool } from 'nostr-tools'
import { Loader2 } from 'lucide-react'

const providers = [
  { name: 'Google', path: '/auth/google' },
  { name: 'GitHub', path: '/auth/github' },
  { name: 'Microsoft', path: '/auth/microsoft' },
  { name: 'Apple', path: '/auth/apple' },
]

const PROFILE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nsec.app',
]

interface Identity {
  id: string
  pubkey: string
  label: string | null
  created_at: number
  active_connections: number
}

interface NostrProfile {
  name?: string
  display_name?: string
  picture?: string
}

function truncate(str: string, len: number = 16): string {
  if (str.length <= len) return str
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2)
}

export default function AuthPopup() {
  const { requestId } = useParams<{ requestId: string }>()
  const [searchParams] = useSearchParams()
  const authenticated = searchParams.get('authenticated') === 'true'

  const [identities, setIdentities] = useState<Identity[]>([])
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({})
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authenticated) return

    const load = async () => {
      try {
        const res = await fetch('/api/identities')
        if (!res.ok) throw new Error('Failed to fetch identities')
        const data: Identity[] = await res.json()
        setIdentities(data)

        // Fetch Nostr profiles
        if (data.length > 0) {
          const pubkeys = data.map((i) => i.pubkey)
          const pool = new SimplePool()
          try {
            const events = await pool.querySync(PROFILE_RELAYS, {
              kinds: [0],
              authors: pubkeys,
            })
            const profileMap: Record<string, NostrProfile> = {}
            for (const event of events) {
              // Only keep the latest profile per pubkey
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
    }

    load()
  }, [authenticated])

  const handleSelect = async (identityId: string) => {
    setSelecting(identityId)
    try {
      const res = await fetch('/api/select-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, identity_id: identityId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to select identity')
      }
      window.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selection failed')
      setSelecting(null)
    }
  }

  // Phase 1: Not authenticated — show OAuth buttons
  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[400px] space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connect to Nostr</CardTitle>
              <CardDescription>Sign in to authorize this connection</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {providers.map((provider) => (
                <Button
                  key={provider.name}
                  variant="outline"
                  className="w-full justify-center"
                  asChild
                >
                  <a href={`${provider.path}?request_id=${requestId}`}>
                    Sign in with {provider.name}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            After signing in, you'll choose a Nostr identity to use.
          </p>
        </div>
      </div>
    )
  }

  // Phase 2: Authenticated — show identity picker
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
        <Card className="w-full max-w-[400px]">
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Choose an Identity</CardTitle>
            <CardDescription>Select a Nostr identity for this connection</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {identities.map((identity) => {
              const profile = profiles[identity.pubkey]
              const displayName = profile?.display_name || profile?.name || identity.label || null
              const isSelecting = selecting === identity.id

              return (
                <Button
                  key={identity.id}
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 px-3 py-3"
                  disabled={selecting !== null}
                  onClick={() => handleSelect(identity.id)}
                >
                  {isSelecting ? (
                    <Loader2 className="h-10 w-10 shrink-0 animate-spin" />
                  ) : profile?.picture ? (
                    <img
                      src={profile.picture}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
                  )}
                  <div className="min-w-0 text-left">
                    {displayName && (
                      <p className="truncate text-sm font-medium">{displayName}</p>
                    )}
                    <p className="truncate text-xs text-muted-foreground font-mono">
                      {truncate(identity.pubkey, 24)}
                    </p>
                  </div>
                </Button>
              )
            })}
            {identities.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">
                No identities available. Ask the administrator to add one.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
