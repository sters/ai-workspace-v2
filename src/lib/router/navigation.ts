/**
 * Navigation hooks over TanStack Router, in the shape the components use:
 * paths and query strings as plain strings. Search params stay strings
 * (`router.tsx` sets a plain `URLSearchParams` parser), so a value read back is
 * the value written.
 */
import { useMemo } from "react";
import { useLocation, useNavigate, useParams as useRouteParams } from "@tanstack/react-router";

type NavigateOptions = { scroll?: boolean };

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions) =>
        void navigate({ href, resetScroll: options?.scroll !== false }),
      replace: (href: string, options?: NavigateOptions) =>
        void navigate({ href, replace: true, resetScroll: options?.scroll !== false }),
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation({ select: (location) => location.pathname });
}

export function useSearchParams(): URLSearchParams {
  const searchStr = useLocation({ select: (location) => location.searchStr });
  return useMemo(() => new URLSearchParams(searchStr), [searchStr]);
}

/** The matched route's path params, decoded. */
export function useParams<T extends Record<string, string>>(): T {
  return useRouteParams({ strict: false }) as T;
}
