'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            // Exponential-ish refetch: start at 5s, double on each successful
            // refetch with no data change, cap at 5min. We approximate with
            // a function-form refetchInterval that bumps based on previous
            // query state via the query meta channel.
            refetchInterval: (query) => {
              const meta = query.state.data ? 30_000 : 5_000
              return meta
            },
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
