import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, Check } from 'lucide-react'

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

export default function Landing() {
  const [bunkerUrl, setBunkerUrl] = useState<string | null>(null)
  const connectionDomain = window.location.host

  useEffect(() => {
    fetch('/api/bunker-url')
      .then((res) => res.json())
      .then((data) => setBunkerUrl(data.bunker_url))
      .catch(() => {})
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Nostr OAuth Signer</h1>
          <p className="text-muted-foreground">
            Use your existing accounts to connect with a Nostr identity.
          </p>
        </div>

        {bunkerUrl && (
          <Card>
            <CardHeader>
              <CardTitle>Connect from any Nostr client</CardTitle>
              <CardDescription>
                Paste the domain or bunker URL into any NIP-46 compatible client.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Domain</label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                    {connectionDomain}
                  </code>
                  <CopyButton text={connectionDomain} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Bunker URL</label>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                    {bunkerUrl}
                  </code>
                  <CopyButton text={bunkerUrl} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Connect from any NIP-46 compatible Nostr client using the domain or bunker URL above.
        </p>
      </div>
    </div>
  )
}
