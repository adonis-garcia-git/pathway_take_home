"use client";

import { ReactNode, useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) {
      // Convex isn't configured yet (Phase 0). Render children without a provider
      // so the existing demo screens still work. Run `npx convex dev` to wire it up.
      return null;
    }
    return new ConvexReactClient(url);
  }, []);

  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
