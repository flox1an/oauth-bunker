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
        sig: string
        id: string
        pubkey: string
        created_at: number
        kind: number
        tags: string[][]
        content: string
      }>
    }
  }
}

export async function getNostrPublicKey(): Promise<string | null> {
  if (!window.nostr) return null
  try {
    return await window.nostr.getPublicKey()
  } catch {
    return null
  }
}

export async function adminFetch(
  path: string,
  method: string = 'GET',
  body?: unknown,
): Promise<Response> {
  if (!window.nostr) {
    throw new Error('No Nostr signer extension found')
  }

  const url = `${window.location.origin}${path}`

  const event = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
    content: '',
  }

  const signedEvent = await window.nostr.signEvent(event)
  const token = btoa(JSON.stringify(signedEvent))

  const headers: Record<string, string> = {
    Authorization: `Nostr ${token}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
