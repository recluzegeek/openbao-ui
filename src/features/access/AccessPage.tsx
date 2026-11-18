import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, ClipboardCheck, Layers3, ShieldCheck, Users } from 'lucide-react';
import { bao } from '@/lib/api';
import { can } from '@/lib/capabilities';
import {
  accessCapabilityPaths,
  useAuthMethods,
  useCapabilities,
  useEnvironments,
  useLayoutDiscovery,
  usePolicies,
  useProjects,
} from '@/lib/queries';
import {
  generateHcl,
  inferRolePolicyNames,
  parseHcl,
  projectPolicyNames,
  simulatorPathsFromLayout,
  templateRulesFromLayout,
  type PolicyRule,
} from '@/lib/policy';
import { useToast } from '@/lib/toast';
import { ErrorState } from '@/components/common/Extras';
import { Field } from '@/components/common/Field';
import { FilterBar } from '@/components/common/FilterBar';
import { RoleTemplates } from './RoleTemplates';
import { PolicyBuilder } from './PolicyBuilder';
import { AccessSimulator } from './AccessSimulator';
import { MachineIdentities } from './MachineIdentities';
import { TeamsPage } from './TeamsPage';
import { EffectiveAccessCard } from './EffectiveAccessCard';

type View = 'roles' | 'builder' | 'simulator' | 'identities' | 'teams';

const VIEWS: { id: View; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'roles', label: 'Role templates', icon: ShieldCheck },
  { id: 'builder', label: 'Policy builder', icon: Layers3 },
  { id: 'simulator', label: 'Access simulator', icon: ClipboardCheck },
  { id: 'identities', label: 'Machine identities', icon: Bot },
  { id: 'teams', label: 'Teams & people', icon: Users },
];

export function AccessPage() {
  const navigate = useNavigate({ from: '/access' });
  const search = useRouterState({ select: (state) => state.location.search }) as Record<string, string | undefined>;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const view: View = VIEWS.some((item) => item.id === search.view) ? search.view as View : 'roles';
  const [project, setProject] = useState(search.project ?? '');
  const [env, setEnv] = useState(search.env ?? '*');
  const [builderName, setBuilderName] = useState(search.project ? `${search.project}-viewer` : '');
  const [builderRules, setBuilderRules] = useState<PolicyRule[]>([]);
  const [builderHcl, setBuilderHcl] = useState<string>();

  const projects = useProjects();
  const envs = useEnvironments(project);
  const policies = usePolicies();
  const authMethods = useAuthMethods();
  const discovery = useLayoutDiscovery(project);
  const profile = discovery.data?.profile;
  const classified = discovery.data?.classified ?? [];
  const policyNames = projectPolicyNames(project, policies.data ?? []);
  const roleNames = inferRolePolicyNames(project, env, policies.data ?? []);
  const caps = useCapabilities(accessCapabilityPaths()).data;
  const canListPolicies = can(caps, 'sys/policies/acl/', 'list');
  const canWritePolicy = can(caps, 'sys/policies/acl/__new__', 'create') || can(caps, 'sys/policies/acl/', 'create');
  const canSimulate = can(caps, 'auth/token/create', 'create');

  useEffect(() => {
    if (!project && projects.data?.length) setProject(projects.data[0]);
  }, [project, projects.data]);

  useEffect(() => {
    if (builderRules.length || builderHcl || !profile || !project) return;
    const rules = templateRulesFromLayout('viewer', project, env, profile, classified);
    setBuilderRules(parseHcl(generateHcl(rules)).rules);
    setBuilderName(roleNames.viewer ?? `${project}-viewer`);
  }, [project, env, profile, classified, builderRules.length, builderHcl, roleNames.viewer]);

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
  const samplePath = classified[0] ? `kv/data/${classified[0].physical}` : undefined;

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="page__header">
        <div>
          <p>Design project-scoped roles, preview the HCL, and check what a user or machine can actually reach.</p>
        </div>
      </div>

      <FilterBar ariaLabel="Access scope" className="access-scope">
        <Field label="Project" htmlFor="access-project" style={{ minWidth: 180 }}>
          <input
            id="access-project"
            className="mono"
            value={project}
            list="access-projects"
            placeholder="Choose a project"
            onChange={(event) => {
              setProject(event.target.value);
              void navigate({ search: (prev) => ({ ...prev, project: event.target.value }), replace: true });
            }}
          />
          <datalist id="access-projects">
            {projectList.map((item) => <option value={item} key={item} />)}
          </datalist>
        </Field>
        <Field label="Environment" htmlFor="access-env" style={{ minWidth: 160 }}>
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
        </Field>
        <p className="small muted filter-bar__hint">
          Role templates, the policy builder and the simulator use this scope.
        </p>
      </FilterBar>

      <EffectiveAccessCard />

      <details className="panel glossary" data-testid="access-glossary">
        <summary className="panel__head" style={{ cursor: 'pointer' }}>
          <ShieldCheck size={17} />
          <h3>What do these terms mean?</h3>
          <span className="small muted">Plain-language glossary</span>
        </summary>
        <div className="panel__body glossary__body">
          <dl>
            <dt>Policy (ACL)</dt>
            <dd>A set of allow/deny rules for API paths. OpenBao checks a policy on every request.</dd>
            <dt>HCL</dt>
            <dd>The text format policies are written in. The builder generates it; you can also paste it.</dd>
            <dt>Role template</dt>
            <dd>A starting policy for a common job (viewer, contributor, admin) scoped to one project and environment.</dd>
            <dt>Team</dt>
            <dd>An identity group. Its members inherit the group's policies.</dd>
            <dt>Machine identity</dt>
            <dd>A non-human login such as an AppRole, used by CI jobs and services.</dd>
            <dt>Simulator</dt>
            <dd>Checks what a set of policies would allow, without changing anything.</dd>
          </dl>
        </div>
      </details>

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
          policies={policyNames}
          profile={profile}
          classified={classified}
          roleNames={roleNames}
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
          samplePath={samplePath}
          onNameChange={setBuilderName}
          onRulesChange={(rules) => { setBuilderRules(rules); setBuilderHcl(undefined); }}
          onSaved={refresh}
        />
      )}
      {view === 'simulator' && (
        <AccessSimulator
          project={project}
          env={env}
          policies={policyNames}
          presetPaths={profile ? simulatorPathsFromLayout(profile, project, env, classified) : undefined}
          samplePath={samplePath}
          canSimulate={canSimulate}
        />
      )}
      {view === 'identities' && (
        <MachineIdentities
          project={project}
          policies={policyNames}
          authMethods={authMethods.data ?? []}
        />
      )}
      {view === 'teams' && (
        <TeamsPage project={project} projects={projectList} />
      )}
    </div>
  );
}
