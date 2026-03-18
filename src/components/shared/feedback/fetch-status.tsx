import { Callout } from "@/components/shared/containers/callout";
import { StatusText } from "@/components/shared/feedback/status-text";

/**
 * Renders common SWR loading / fetch-error / API-error states.
 * Returns `null` when there is nothing to display, so the caller
 * can simply render `<FetchStatus … />` before the success branch.
 */
export function FetchStatus({
  isLoading,
  error,
  apiError,
  loadingText = "Loading...",
  errorText = "Failed to fetch data.",
}: {
  isLoading: boolean;
  error: unknown;
  apiError?: string;
  loadingText?: string;
  errorText?: string;
}) {
  return (
    <>
      {isLoading && <StatusText>{loadingText}</StatusText>}
      {error && <StatusText variant="error">{errorText}</StatusText>}
      {apiError && (
        <Callout variant="error">
          <StatusText variant="error">{apiError}</StatusText>
        </Callout>
      )}
    </>
  );
}
