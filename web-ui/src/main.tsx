import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EventStoreProvider } from 'applesauce-react/providers'
import { eventStore } from '@/lib/nostr-profiles'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EventStoreProvider eventStore={eventStore}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </EventStoreProvider>
  </StrictMode>,
)
