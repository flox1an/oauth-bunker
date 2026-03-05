import { EventStore } from 'applesauce-core'
import { RelayPool } from 'applesauce-relay/pool'
import { createAddressLoader } from 'applesauce-loaders/loaders'

const PROFILE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nsec.app',
  'wss://purplepag.es',
]

export const eventStore = new EventStore()
export const pool = new RelayPool()

export const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: PROFILE_RELAYS,
})

/** Fire-and-forget: ensure a profile is loaded into the EventStore */
export function requestProfile(pubkey: string) {
  if (eventStore.hasReplaceable(0, pubkey)) return
  addressLoader({ kind: 0, pubkey, relays: PROFILE_RELAYS }).subscribe()
}

/** Request multiple profiles at once */
export function requestProfiles(pubkeys: string[]) {
  for (const pk of pubkeys) {
    requestProfile(pk)
  }
}
