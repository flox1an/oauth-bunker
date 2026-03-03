import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const providers = [
  { name: 'Google', path: '/auth/google' },
  { name: 'GitHub', path: '/auth/github' },
  { name: 'Microsoft', path: '/auth/microsoft' },
  { name: 'Apple', path: '/auth/apple' },
]

export default function Landing() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Nostr OAuth Signer</h1>
          <p className="text-muted-foreground">
            Sign in with your existing account to get a Nostr identity. No keys to manage.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>Choose a provider to continue</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {providers.map((provider) => (
              <Button
                key={provider.name}
                variant="outline"
                className="w-full justify-center"
                asChild
              >
                <a href={provider.path}>Sign in with {provider.name}</a>
              </Button>
            ))}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Your Nostr keys are generated and encrypted on the server. You can import your own key later.
        </p>
      </div>
    </div>
  )
}
