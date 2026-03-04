import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Copy, Check, Loader2 } from 'lucide-react'

interface UserInfo {
  user_id: string
  oauth_provider: string
  email: string | null
  created_at: number
  bunker_url: string
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connectionDomain = window.location.host

  const fetchData = useCallback(async () => {
    try {
      const meRes = await fetch('/api/me')

      if (meRes.status === 401) {
        window.location.href = '/'
        return
      }

      if (!meRes.ok) {
        throw new Error('Failed to fetch data')
      }

      const meData = await meRes.json()
      setUser(meData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

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
      </div>
    </div>
  )
}
