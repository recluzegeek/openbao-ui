import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, ClipboardCheck, Layers3, ShieldCheck } from 'lucide-react';
import { bao } from '@/lib/api';
import { can } from '@/lib/capabilities';
import { accessCapabilityPaths, useAuthMethods, useCapabilities, useEnvironments, usePolicies, useProjects } from '@/lib/queries';
import { generateHcl, parseHcl, type PolicyRule } from '@/lib/policy';
import { useToast } from '@/lib/toast';
import { ErrorState } from '@/components/common/Extras';
import { RoleTemplates } from './RoleTemplates';
import { PolicyBuilder } from './PolicyBuilder';
import { AccessSimulator } from './AccessSimulator';
import { MachineIdentities } from './MachineIdentities';

type View = 'roles' | 'builder' | 'simulator' | 'identities';

const VIEWS: { id: View; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'roles', label: 'Role templates', icon: ShieldCheck },
  { id: 'builder', label: 'Policy builder', icon: Layers3 },
  { id: 'simulator', label: 'Access simulator', icon: ClipboardCheck },
  { id: 'identities', label: 'Machine identities', icon: Bot },
];

export function AccessPage() {
  const navigate = useNavigate({ from: '/access' });
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const view: View = VIEWS.some((item) => item.id === search.view) ? search.view as View : 'roles';
  const [project, setProject] = useState(search.project ?? 'ui-demo');
  const [env, setEnv] = useState(search.env ?? '*');
  const [builderName, setBuilderName] = useState(`${search.project ?? 'ui-demo'}-viewer`);
  const [builderRules, setBuilderRules] = useState<PolicyRule[]>([]);
  const [builderHcl, setBuilderHcl] = useState<string>();

  const projects = useProjects();
  const envs = useEnvironments(project);
  const policies = usePolicies();
  const authMethods = useAuthMethods();
  const caps = useCapabilities(accessCapabilityPaths()).data;
  const canListPolicies = can(caps, 'sys/policies/acl/', 'list');
  const canWritePolicy = can(caps, 'sys/policies/acl/__new__', 'create') || can(caps, 'sys/policies/acl/', 'create');
  const canSimulate = can(caps, 'auth/token/create', 'create');

  useEffect(() => {
    if (!builderRules.length && !builderHcl) {
      const parsed = parseHcl(generateHcl([
        { path: `kv/data/${project}/env/*`, capabilities: ['read'] },
      ]));
      setBuilderRules(parsed.rules);
      setBuilderName(`${project}-viewer`);
    }
  }, [project]);

  function setView(next: View) {
    void navigate({ search: (prev) => ({ ...prev, view: next === 'roles' ? undefined : next }), replace: true });
  }

  function loadBuilder(name: string, rules: PolicyRule[], raw?: string) {
    setBuilderName(name);
    setBuilderRules(rules);
    setBuilderHcl(raw);
    setView('builder');
  }

  async function openPolicy(name: string) {
    try {
      const result = await bao.readPolicy(name);
      const parsed = parseHcl(result.data.policy);
      if (parsed.error) {
        loadBuilder(name, [], result.data.policy);
        addToast('warning', 'Opened as raw HCL', 'This policy uses HCL the visual builder cannot fully parse.');
      } else {
        loadBuilder(name, parsed.rules);
      }
    } catch (error) {
      addToast('error', 'Could not load the policy', error instanceof Error ? error.message : undefined);
    }
  }

  function refresh() {
    void queryClient.invalidateQueries();
  }

  const projectList = projects.data ?? [];
  const envList = envs.data ?? [];

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="page__header">
        <div>
          <h2>Access control</h2>
          <p>Design project-scoped roles, preview the HCL, and check what a user or machine can actually reach.</p>
        </div>
        <div className="topbar__actions">
          <label className="small muted" htmlFor="access-project">Project</label>
          <input
            id="access-project"
            className="mono"
            value={project}
            list="access-projects"
            onChange={(event) => {
              setProject(event.target.value);
              void navigate({ search: (prev) => ({ ...prev, project: event.target.value }), replace: true });
            }}
            style={{ width: 140 }}
          />
          <datalist id="access-projects">
            {projectList.map((item) => <option value={item} key={item} />)}
          </datalist>
          <label className="small muted" htmlFor="access-env">Environment</label>
          <select
            id="access-env"
            value={env}
            onChange={(event) => {
              setEnv(event.target.value);
              void navigate({ search: (prev) => ({ ...prev, env: event.target.value === '*' ? undefined : event.target.value }), replace: true });
            }}
          >
            <option value="*">All environments</option>
            {envList.map((item) => <option value={item} key={item} />)}
          </select>
        </div>
      </div>

      {policies.isError && <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />}
      {!canListPolicies && caps && (
        <div className="notice warning small">
          Your token cannot list ACL policies. Templates and the visual builder still work locally; saving and real
          simulation need a policy admin token.
        </div>
      )}

      <div className="tabs access-tabs" role="tablist" aria-label="Access control sections">
        {VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={`tab ${view === id ? 'active' : ''}`}
            onClick={() => setView(id)}
            data-testid={`access-tab-${id}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {view === 'roles' && (
        <RoleTemplates
          project={project}
          env={env}
          canWrite={canWritePolicy}
          policies={(policies.data ?? []).filter((name) => name.startsWith(project))}
          onLoadTemplate={loadBuilder}
          onOpenPolicy={(name) => void openPolicy(name)}
          onSaved={refresh}
        />
      )}
      {view === 'builder' && (
        <PolicyBuilder
          project={project}
          name={builderName}
          rules={builderRules}
          initialHcl={builderHcl}
          canWrite={canWritePolicy}
          existingPolicies={policies.data ?? []}
          onNameChange={setBuilderName}
          onRulesChange={(rules) => { setBuilderRules(rules); setBuilderHcl(undefined); }}
          onSaved={refresh}
        />
      )}
      {view === 'simulator' && (
        <AccessSimulator
          project={project}
          env={env}
          policies={policies.data ?? []}
          canSimulate={canSimulate}
        />
      )}
      {view === 'identities' && (
        <MachineIdentities
          project={project}
          policies={policies.data ?? []}
          authMethods={authMethods.data ?? []}
        />
      )}
    </div>
  );
}
