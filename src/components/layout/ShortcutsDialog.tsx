import { Keyboard } from 'lucide-react';
import { SHORTCUTS } from '@/lib/setup';
import { Dialog } from '@/components/common/Extras';

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} testId="shortcuts-dialog" footer={<span className="small muted">Press Esc to close</span>}>
      <p className="small muted" style={{ marginBottom: '0.75rem' }}>
        Shortcuts pause while you are typing in a field so they never interfere with secret values.
      </p>
      <dl className="shortcut-list" data-testid="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.keys}>
            <dt>{shortcut.label}</dt>
            <dd><kbd>{shortcut.keys}</kbd></dd>
          </div>
        ))}
      </dl>
      <p className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: '0.75rem' }}>
        <Keyboard size={14} /> Available across the whole console.
      </p>
    </Dialog>
  );
}
