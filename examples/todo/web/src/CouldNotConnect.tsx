export interface CouldNotConnectProps {
  onRetry: () => void;
}

/**
 * The one thing the app says in its own words: without the composer, it has no others. A real app
 * might say it in a few languages.
 */
export function CouldNotConnect(props: CouldNotConnectProps) {
  const { onRetry } = props;

  return (
    <p className="status">
      Couldn't reach the composer. Is one running?{" "}
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}
