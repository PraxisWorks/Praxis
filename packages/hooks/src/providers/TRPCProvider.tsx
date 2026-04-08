import React, { useState, useRef } from "react";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { httpBatchLink, splitLink, createWSClient, wsLink } from "@trpc/client";
import { trpc } from "../trpc.js";

type TRPCProviderProps = {
  children: React.ReactNode;
  apiUrl: string;
  getAccessToken: () => Promise<string>;
  onAuthError?: () => void;
};

function deriveWsUrl(apiUrl: string): string {
  if (apiUrl.startsWith("/")) {
    if (typeof window === "undefined") return "ws://localhost:3001/api/trpc";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${apiUrl}`;
  }
  return apiUrl.replace(/^http/, "ws");
}

export function TRPCProvider({ children, apiUrl, getAccessToken, onAuthError }: TRPCProviderProps) {
  const onAuthErrorRef = useRef(onAuthError);
  onAuthErrorRef.current = onAuthError;
  const authErrorFiredRef = useRef(false);

  const handleError = (error: unknown) => {
    const trpcError = error as { data?: { code?: string } };
    if (
      trpcError?.data?.code === "UNAUTHORIZED" &&
      onAuthErrorRef.current &&
      !authErrorFiredRef.current
    ) {
      authErrorFiredRef.current = true;
      onAuthErrorRef.current();
    }
  };

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleError }),
        mutationCache: new MutationCache({ onError: handleError }),
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  const [trpcClient] = useState(() => {
    const wsClient = createWSClient({
      url: deriveWsUrl(apiUrl),
      connectionParams: async () => {
        try {
          const token = await getAccessToken();
          return { token };
        } catch {
          return {};
        }
      },
      keepAlive: {
        enabled: true,
        intervalMs: 10_000,
        pongTimeoutMs: 5_000,
      },
      retryDelayMs: (attemptIndex) =>
        Math.min(1000 * Math.pow(2, attemptIndex), 30_000),
    });

    return trpc.createClient({
      links: [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: wsClient }),
          false: httpBatchLink({
            url: apiUrl,
            async headers() {
              try {
                const token = await getAccessToken();
                return { Authorization: `Bearer ${token}` };
              } catch {
                return {};
              }
            },
          }),
        }),
      ],
    });
  });

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
