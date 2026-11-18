import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useSetupStage } from '@/lib/queries';
import { dismissOnboarding, isOnboardingDismissed } from '@/lib/setup';
import { Button } from '@/components/common/Button';

/** First-run hint that points at the getting-started guide; dismiss is remembered locally. */
export function OnboardingBanner() {
  const navigate = useNavigate();
  const stage = useSetupStage();
  const [visible, setVisible] = useState(() => !isOnboardingDismissed());
  if (!visible || stage === 'ready') return null;

  return (
    <div className="onboarding-banner" role="note" data-testid="onboarding-banner">
      <Sparkles size={18} />
      <span><strong>New here?</strong> Follow the short setup guide to connect, unseal and create your first project.</span>
      <Button
        size="small"
        variant="outlined"
        icon={<ArrowRight size={14} />}
        onClick={() => void navigate({ to: '/welcome' })}
        data-testid="onboarding-open"
      >
        Get started
      </Button>
      <button
        className="icon-btn"
        aria-label="Dismiss setup hint"
        title="Dismiss"
        data-testid="onboarding-dismiss"
        onClick={() => { dismissOnboarding(); setVisible(false); }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
