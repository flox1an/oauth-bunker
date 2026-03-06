import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { nip19, SimplePool } from 'nostr-tools'
import { Loader2, Plus } from 'lucide-react'

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: {
        kind: number
        created_at: number
        tags: string[][]
        content: string
      }): Promise<{
        id: string
        pubkey: string
        created_at: number
        kind: number
        tags: string[][]
        content: string
        sig: string
      }>
    }
  }
}

const PROVIDER_META: Record<string, { name: string; path: string }> = {
  google: { name: 'Google', path: '/auth/google' },
  github: { name: 'GitHub', path: '/auth/github' },
  microsoft: { name: 'Microsoft', path: '/auth/microsoft' },
  apple: { name: 'Apple', path: '/auth/apple' },
  nostr: { name: 'Nostr Extension', path: '' },
}

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

interface MeInfo {
  user_id: string
  oauth_provider: string
  oauth_sub: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
}

interface Features {
  auto_select_single_identity: boolean
  allow_user_identity_creation: boolean
}

function truncate(str: string, len: number = 16): string {
  if (str.length <= len) return str
  return str.slice(0, len / 2) + '...' + str.slice(-len / 2)
}

export default function AuthPopup() {
  const { requestId } = useParams<{ requestId: string }>()
  const [searchParams] = useSearchParams()
  const authenticated = searchParams.get('authenticated') === 'true'

  const [providers, setProviders] = useState<{ name: string; path: string }[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [me, setMe] = useState<MeInfo | null>(null)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({})
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [features, setFeatures] = useState<Features>({ auto_select_single_identity: false, allow_user_identity_creation: true })
  const [rejecting, setRejecting] = useState(false)
  const [rejectCountdown, setRejectCountdown] = useState<number | null>(null)
  const [hasNostrExtension, setHasNostrExtension] = useState(false)
  const [nostrLoading, setNostrLoading] = useState(false)

  useEffect(() => {
    if (authenticated) return
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => {
        const enabled = (data.providers as string[])
          .map((id) => PROVIDER_META[id])
          .filter(Boolean)
        setProviders(enabled)
      })
      .catch(() => {})
      .finally(() => setProvidersLoading(false))
  }, [authenticated])

  useEffect(() => {
    const timer = setTimeout(() => {
      setHasNostrExtension(!!window.nostr)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!authenticated) return

    const load = async () => {
      try {
        // Fetch user info, identities, and features in parallel
        const [meRes, res, featRes] = await Promise.all([
          fetch('/api/me'),
          fetch('/api/identities'),
          fetch('/api/features'),
        ])
        if (meRes.ok) {
          const meData: MeInfo = await meRes.json()
          // If signed in with Nostr, fetch their kind 0 profile for avatar/name
          if (meData.oauth_provider === 'nostr' && meData.oauth_sub) {
            try {
              const pool = new SimplePool()
              const events = await pool.querySync(PROFILE_RELAYS, {
                kinds: [0],
                authors: [meData.oauth_sub],
              })
              if (events.length > 0) {
                const profile: NostrProfile = JSON.parse(events[0].content)
                if (profile.display_name || profile.name) {
                  meData.display_name = profile.display_name || profile.name || null
                }
                if (profile.picture) {
                  meData.avatar_url = profile.picture
                }
              }
            } catch {
              // Profile fetch is best-effort
            }
          }
          setMe(meData)
        }
        if (!res.ok) throw new Error('Failed to fetch identities')
        const data: Identity[] = await res.json()

        let feat: Features = { auto_select_single_identity: false, allow_user_identity_creation: true }
        if (featRes.ok) {
          feat = await featRes.json()
          setFeatures(feat)
        }

        // Auto-select if user has exactly one identity and feature is enabled
        if (feat.auto_select_single_identity && data.length === 1 && requestId) {
          setSelecting(data[0].id)
          try {
            const selectRes = await fetch('/api/select-identity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ request_id: requestId, identity_id: data[0].id }),
            })
            if (selectRes.ok) {
              window.close()
              return
            }
          } catch {
            // Fall through to show identity picker
          }
          setSelecting(null)
        }

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

  const handleCreate = async () => {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create identity')
      }
      const created = await res.json()
      // Select the newly created identity immediately
      await handleSelect(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create identity')
      setCreating(false)
    }
  }

  const handleReject = async () => {
    if (!requestId || rejecting) return
    setRejecting(true)
    try {
      await fetch('/api/reject-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId }),
      })
    } catch {
      // Best effort — close the popup regardless
    }
    window.close()
  }

  const handleNostrLogin = async () => {
    if (!window.nostr) return
    setNostrLoading(true)
    setError(null)
    try {
      const event = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', `${window.location.origin}/api/auth/nostr`],
          ['method', 'POST'],
        ],
        content: '',
      }
      const signed = await window.nostr.signEvent(event)
      const res = await fetch('/api/auth/nostr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signed_event: JSON.stringify(signed),
          request_id: requestId,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Nostr auth failed')
      }
      window.location.href = `/auth-popup/${requestId}?authenticated=true`
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nostr login failed')
      setNostrLoading(false)
    }
  }

  // Auto-reject countdown when no identities and user can't create them
  useEffect(() => {
    if (!authenticated || loading) return
    if (identities.length > 0 || features.allow_user_identity_creation) return
    setRejectCountdown(3)
  }, [authenticated, loading, identities.length, features.allow_user_identity_creation])

  useEffect(() => {
    if (rejectCountdown === null) return
    if (rejectCountdown <= 0) {
      handleReject()
      return
    }
    const timer = setTimeout(() => setRejectCountdown(rejectCountdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [rejectCountdown])

  // Phase 1: Not authenticated — show OAuth buttons
  if (!authenticated) {
    if (providersLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )
    }

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[400px] space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connect to Nostr</CardTitle>
              <CardDescription>Sign in to authorize this connection</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {providers.map((provider) =>
                provider.name === 'Nostr Extension' ? null : (
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
                )
              )}
              {providers.some((p) => p.name === 'Nostr Extension') && hasNostrExtension && (
                <Button
                  variant="outline"
                  className="w-full justify-center"
                  disabled={nostrLoading}
                  onClick={handleNostrLogin}
                >
                  {nostrLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Sign in with Nostr Extension
                </Button>
              )}
              {providers.filter((p) => p.name !== 'Nostr Extension').length === 0 &&
                !(providers.some((p) => p.name === 'Nostr Extension') && hasNostrExtension) && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No sign-in providers configured.
                </p>
              )}
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
        {me && (
          <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
            {me.avatar_url ? (
              <img
                src={me.avatar_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-full bg-muted" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {me.display_name || me.email || me.user_id}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Signed in with {me.oauth_provider.charAt(0).toUpperCase() + me.oauth_provider.slice(1)}
              </p>
            </div>
          </div>
        )}
        {identities.length === 0 && !features.allow_user_identity_creation ? (
          <Card>
            <CardContent className="py-6 space-y-3">
              <p className="text-center text-sm">
                <span className="font-medium text-destructive">No identities assigned.</span>{' '}
                <span className="text-muted-foreground">Contact your administrator.</span>
              </p>
              <p className="text-center text-xs text-muted-foreground">
                Closing in {rejectCountdown ?? 0}s...
              </p>
            </CardContent>
          </Card>
        ) : (
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
                        {truncate(nip19.npubEncode(identity.pubkey), 24)}
                      </p>
                    </div>
                  </Button>
                )
              })}
              {identities.length === 0 && features.allow_user_identity_creation && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  No identities yet. Create one to get started.
                </p>
              )}
              {features.allow_user_identity_creation && (
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 px-3 py-3 border border-dashed"
                  disabled={selecting !== null || creating}
                  onClick={handleCreate}
                >
                  {creating ? (
                    <Loader2 className="h-10 w-10 shrink-0 animate-spin" />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Plus className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-medium">Create new identity</p>
                    <p className="text-xs text-muted-foreground">
                      Generate a new Nostr keypair
                    </p>
                  </div>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
