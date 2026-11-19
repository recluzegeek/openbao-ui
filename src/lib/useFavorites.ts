import { useEffect, useState } from 'react';
import { loadFavorites, type SecretRef } from './navigationMemory';

/** Favorites live in localStorage across tabs; keep this tab in sync. */
export function useFavorites(): SecretRef[] {
  const [favorites, setFavorites] = useState<SecretRef[]>(() => loadFavorites());
  useEffect(() => {
    const sync = () => setFavorites(loadFavorites());
    window.addEventListener('console:favorites-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('console:favorites-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return favorites;
}
