import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const providers = [
  { name: 'Google', path: '/auth/google' },
  { name: 'GitHub', path: '/auth/github' },
  { name: 'Microsoft', path: '/auth/microsoft' },
  { name: 'Apple', path: '/auth/apple' },
]

export default function AuthPopup() {
  const { requestId } = useParams<{ requestId: string }>()

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
          After signing in, this window will close and your Nostr client will be connected.
        </p>
      </div>
    </div>
  )
}
