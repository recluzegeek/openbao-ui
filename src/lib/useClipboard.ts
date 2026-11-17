import { useCallback } from 'react';
import { useToast } from './toast';

export function useClipboard() {
  const { addToast } = useToast();

  return useCallback(
    async (text: string, label = 'Copied') => {
      try {
        await navigator.clipboard.writeText(text);
        addToast('success', label);
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        addToast('success', label);
      }
    },
    [addToast],
  );
}
