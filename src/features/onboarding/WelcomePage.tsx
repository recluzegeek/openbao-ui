import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Check,
  CircleDot,
  Compass,
  Database,
  KeyRound,
  LockKeyhole,
  Rocket,
  Server,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  completeOnboarding,
  dismissOnboarding,
  isOnboardingComplete,
  setupSnippets,
  type SetupStage,
} from '@/lib/setup';
import { useKvMount, useProjects, useSetupHealth, useSetupSeal, useSetupStage } from '@/lib/queries';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet } from '@/components/common/Extras';

interface Step {
  id: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
  done: boolean;
  detail?: ReactNode;
}

const STAGE_TITLES: Record<SetupStage, string> = {
  checking: 'Checking your OpenBao server…',
  unreachable: 'OpenBao is not reachable yet',
  uninitialized: 'Your OpenBao server needs initializing',
  sealed: 'OpenBao is sealed',
  'no-mount': 'No KV engine is mounted yet',
  'no-projects': 'No secrets have been created yet',
  ready: 'You are ready to go',
};

export function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const health = useSetupHealth();
  const seal = useSetupSeal();
  const kv = useKvMount();
  const projects = useProjects();

  const stage = useSetupStage();
  const setupComplete = stage === 'ready';

  useEffect(() => {
    if (setupComplete && !isOnboardingComplete()) completeOnboarding();
  }, [setupComplete]);

  function finish() {
    completeOnboarding();
    void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } });
  }

  // A token without sys/mounts read cannot confirm the mount, but readable project
  // data proves a KV engine exists — don't leave that step looking unfinished.
  const kvReady = kv.data === true || (kv.isError && (projects.data?.length ?? 0) > 0);

  const steps: Step[] = [
    {
      id: 'connect',
      title: 'Connect to OpenBao',
      description: 'The console talks to the standard HTTP API — no custom backend.',
      icon: <Server size={18} />,
      done: Boolean(health.data),
      detail: health.isError
        ? <p className="small notice error">Cannot reach the server. Check the address on the sign-in screen and that the container is running.</p>
        : undefined,
    },
    {
      id: 'unseal',
      title: 'Initialize and unseal',
      description: 'A fresh server is initialized once, then unsealed whenever it restarts.',
      icon: <LockKeyhole size={18} />,
      done: Boolean(health.data?.initialized) && seal.data?.sealed === false,
      detail: health.data && !health.data.initialized ? (
        <div className="grid" style={{ gap: '0.5rem' }}>
          <p className="small muted">Run this on the server and store the generated keys outside this console — they are never shown here.</p>
          <CodeSnippet text={setupSnippets.init} label="Init command" />
        </div>
      ) : seal.data?.sealed ? (
        <div className="grid" style={{ gap: '0.5rem' }}>
          <CodeSnippet text={setupSnippets.unseal} label="Unseal command" />
          <Button size="small" variant="outlined" onClick={() => void navigate({ to: '/login' })}>Unseal in the sign-in screen</Button>
        </div>
      ) : undefined,
    },
    {
      id: 'mount',
      title: 'Enable a version-2 KV engine',
      description: <>Secrets, folders, versions and metadata live in a KV engine such as <code>kv/</code>.</>,
      icon: <Database size={18} />,
      done: kvReady,
      detail: kv.data === false
        ? <CodeSnippet text={setupSnippets.enableKv} label="Enable KV" />
        : kv.isError ? <p className="small muted">Mount status is hidden for this token, but readable project data confirms KV is enabled.</p> : undefined,
    },
    {
      id: 'project',
      title: 'Create your first project',
      description: <>A project maps to a KV subtree; paths are discovered from your server, for example <code>kv/data/my-project/env/development/web</code>.</>,
      icon: <KeyRound size={18} />,
      done: (projects.data?.length ?? 0) > 0,
      detail: projects.data?.length === 0 ? (
        <div className="grid" style={{ gap: '0.5rem' }}>
          <CodeSnippet text={setupSnippets.createSecret} label="Create secret" />
          <p className="small muted">Prefer a ready-made demo? {setupSnippets.seedDemo}</p>
          <Button size="small" variant="outlined" icon={<ArrowRight size={14} />} onClick={() => void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } })}>
            Open the secrets browser
          </Button>
        </div>
      ) : undefined,
    },
    {
      id: 'explore',
      title: 'Explore the console',
      description: 'Search across environments, inspect access, and read the audit trail.',
      icon: <Compass size={18} />,
      done: setupComplete,
      detail: (
        <div className="method-chips">
          <Button size="small" variant="outlined" onClick={() => window.dispatchEvent(new Event('console:open-palette'))}>Global search</Button>
          <Button size="small" variant="outlined" onClick={() => void navigate({ to: '/access', search: { view: undefined, project: undefined, env: undefined } })}>Access control</Button>
          <Button size="small" variant="outlined" onClick={() => void navigate({ to: '/audit', search: { q: undefined, actor: undefined, operation: undefined, range: undefined } })}>Audit log</Button>
          <Button size="small" variant="outlined" onClick={() => void navigate({ to: '/automation', search: { path: undefined } })}>For agents</Button>
        </div>
      ),
    },
  ];

  const doneCount = steps.filter((step) => step.id !== 'explore' && step.done).length;
  const currentId = setupComplete ? undefined : steps.find((step) => !step.done)?.id;
  const checking = stage === 'checking' && health.isLoading;

  return (
    <div className="grid" style={{ gap: '1rem' }} data-testid="welcome-page" data-stage={stage}>
      <div className="page__header">
        <div>
          <p>A short checklist that follows the real state of your OpenBao server.</p>
        </div>
        {setupComplete ? (
          <Badge variant="success" data-testid="welcome-complete"><Rocket size={13} /> Setup complete</Badge>
        ) : (
          <Badge variant="primary"><Rocket size={13} /> {doneCount}/{steps.length - 1} set up</Badge>
        )}
      </div>

      <div className="notice info small" data-testid="welcome-stage">
        <Activity size={14} /> {STAGE_TITLES[stage]}
      </div>

      {checking && <div className="state"><div className="spinner" /></div>}

      <ol className="welcome-steps">
        {steps.map((step, index) => {
          const state = step.done ? 'done' : step.id === currentId ? 'current' : 'todo';
          return (
            <li
              key={step.id}
              className={`welcome-step welcome-step--${state}`}
              data-testid={`welcome-step-${step.id}`}
              data-state={state}
            >
              <div className="welcome-step__marker" aria-hidden="true">
                {step.done ? <Check size={16} /> : <CircleDot size={16} />}
              </div>
              <div className="welcome-step__body">
                <div className="welcome-step__head">
                  <span className="welcome-step__icon">{step.icon}</span>
                  <h3>{index + 1}. {step.title}</h3>
                  {step.done && <Badge size="small" variant="success">done</Badge>}
                  {state === 'current' && <Badge size="small" variant="primary">next</Badge>}
                </div>
                <p className="small muted">{step.description}</p>
                {state === 'current' && step.detail && <div className="welcome-step__detail">{step.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="panel">
        <div className="panel__body panel-actions">
          <Button icon={<ArrowRight size={15} />} onClick={finish} data-testid="welcome-finish">Go to secrets</Button>
          <Button
            variant="ghost"
            onClick={() => {
              dismissOnboarding();
              void queryClient.invalidateQueries();
              void navigate({ to: '/secrets', search: { project: undefined, env: undefined, service: undefined, folder: undefined } });
            }}
            data-testid="welcome-dismiss"
          >
            Skip for now
          </Button>
          <span className="small muted">You can reopen this guide any time from the sidebar.</span>
        </div>
      </div>
    </div>
  );
}
