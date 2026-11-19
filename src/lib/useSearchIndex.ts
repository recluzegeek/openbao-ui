import { useSyncExternalStore } from 'react';
import { searchIndex, type IndexStatus } from './searchIndex';

/** Live index progress for the palette and the Refresh index action. */
export function useSearchIndexStatus(): IndexStatus {
  return useSyncExternalStore(
    (listener) => searchIndex.subscribe(listener),
    () => searchIndex.getStatus(),
  );
}
