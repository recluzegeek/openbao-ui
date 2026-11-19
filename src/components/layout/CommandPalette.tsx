import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Activity, ArrowRight, Clock3, Compass, CornerDownLeft, KeyRound, Search, Shield, Star, Trash2 } from 'lucide-react';
import { folderOf, loadFavorites, loadRecent, type SecretRef } from '@/lib/navigationMemory';
import { matchesSearch } from '@/lib/searchMatch';

interface Action {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  useEffect(() => {
    const opener = () => setOpen(true);
    window.addEventListener('console:open-palette', opener);
    return () => window.removeEventListener('console:open-palette', opener);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const goToRef = (ref: SecretRef) => {
      void navigate({
        to: '/secrets',
        search: { project: ref.project, env: ref.env, service: ref.path, folder: folderOf(ref.path) || undefined },
      });
    };
    const routeActions: Action[] = [
      {
        id: 'route-welcome',
        label: 'Getting started',
        group: 'Go to',
        icon: <Compass size={16} />,
        run: () => void navigate({ to: '/welcome' }),
      },
      {
        id: 'route-secrets',
        label: 'Secrets',
        group: 'Go to',
        icon: <KeyRound size={16} />,
        run: () => void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } }),
      },
      {
        id: 'route-trash',
        label: 'Trash (deleted versions)',
        group: 'Go to',
        icon: <Trash2 size={16} />,
        run: () => void navigate({ to: '/trash', search: { project: undefined } }),
      },
      {
        id: 'route-search',
        label: 'Global search',
        group: 'Go to',
        icon: <Search size={16} />,
        run: () => void navigate({ to: '/search', search: { q: undefined } }),
      },
      {
        id: 'route-access',
        label: 'Access control',
        group: 'Go to',
        icon: <Shield size={16} />,
        run: () => void navigate({ to: '/access', search: { view: undefined, project: undefined, env: undefined } }),
      },
      {
        id: 'route-audit',
        label: 'Audit log',
        group: 'Go to',
        icon: <Activity size={16} />,
        run: () => void navigate({ to: '/audit', search: { q: undefined, actor: undefined, operation: undefined, range: undefined } }),
      },
    ];
    const recentActions: Action[] = loadRecent().map((ref) => ({
      id: `recent-${ref.project}-${ref.env}-${ref.path}`,
      label: `${ref.project} / ${ref.env} / ${ref.path}`,
      group: 'Recent',
      icon: <Clock3 size={16} />,
      run: () => goToRef(ref),
    }));
    const favoriteActions: Action[] = loadFavorites().map((ref) => ({
      id: `fav-${ref.project}-${ref.env}-${ref.path}-${ref.key ?? ''}`,
      label: `${ref.project} / ${ref.env} / ${ref.path}${ref.key ? ` · ${ref.key}` : ''}`,
      group: 'Favorites',
      icon: <Star size={16} />,
      run: () => goToRef(ref),
    }));
    const searchAction: Action = {
      id: 'search-query',
      label: query.trim() ? `Search for “${query.trim()}”` : 'Search all secrets',
      group: 'Search',
      icon: <Search size={16} />,
      run: () => void navigate({ to: '/search', search: { q: query.trim() || undefined } }),
    };
    return [searchAction, ...routeActions, ...recentActions, ...favoriteActions];
  }, [navigate, query, open]);

  const filtered = actions.filter((action) => matchesSearch([action.label, action.group], query));

  function run(action: Action) {
    setOpen(false);
    action.run();
  }

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette">
        <div className="palette__input">
          <Search size={18} />
          <input
            ref={inputRef}
            aria-label="Command or search"
            placeholder="Jump to a secret, search, or run a command…"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, filtered.length - 1)); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
              if (event.key === 'Enter' && filtered[selected]) { event.preventDefault(); run(filtered[selected]); }
            }}
          />
          <kbd className="palette__esc" aria-hidden="true">esc</kbd>
        </div>
        <ul className="palette__list" role="listbox" aria-label="Commands">
          {filtered.map((action, index) => (
            <li key={action.id} role="option" aria-selected={index === selected}>
              <button
                className={`palette__item ${index === selected ? 'selected' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(action)}
                data-testid={`palette-${action.group.toLowerCase()}`}
              >
                {action.icon}
                <span>{action.label}</span>
                <span className="palette__group">{action.group}</span>
                {index === selected && <CornerDownLeft size={14} />}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="palette__empty">No commands match that.</li>}
        </ul>
        <div className="palette__foot"><ArrowRight size={12} /> Up/down to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
