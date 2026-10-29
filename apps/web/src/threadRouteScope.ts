import type { ScopedThreadRef } from "@t3tools/contracts";
import { createContext } from "react";

// Embedded conversations and their tools keep the child scope while the URL names the host.
export const ThreadRouteScope = createContext<ScopedThreadRef | null>(null);
