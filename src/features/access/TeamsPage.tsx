import { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { bao, type IdentityGroup } from '@/lib/api';
import { can, deniedReason } from '@/lib/capabilities';
import {
  teamCapabilityPaths,
  useCapabilities,
  useEntities,
  useGroups,
  usePolicies,
  useUserpassUsers,
} from '@/lib/queries';
import { matchesSearch } from '@/lib/searchMatch';
import { parseTeamName, teamsSharingPolicy } from '@/lib/teams';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { Field } from '@/components/common/Field';
import { FilterBar } from '@/components/common/FilterBar';
import { CopyButton, Dialog, EmptyState, ErrorState } from '@/components/common/Extras';

type Section = 'teams' | 'people';

function policyList(policies: string[]) {
  if (policies.length === 0) return <span className="small muted">No policies</span>;
  return (
    <span className="method-chips">
      {policies.slice(0, 4).map((policy) => <span className="method-chip" key={policy}><code>{policy}</code></span>)}
      {policies.length > 4 && <span className="small muted">+{policies.length - 4}</span>}
    </span>
  );
}

export function TeamsPage({ project, projects }: { project: string; projects: string[] }) {
  const [section, setSection] = useState<Section>('teams');
  const caps = useCapabilities(teamCapabilityPaths()).data;
  const canListGroups = can(caps, 'identity/group/name', 'list') || can(caps, 'identity/group/name/', 'list');
  const canListUsers = can(caps, 'auth/userpass/users', 'list') || can(caps, 'auth/userpass/users/', 'list');

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="tabs" role="tablist" aria-label="Teams and people">
        <button
          role="tab"
          aria-selected={section === 'teams'}
          className={`tab ${section === 'teams' ? 'active' : ''}`}
          onClick={() => setSection('teams')}
          data-testid="teams-tab-teams"
        >
          <Users size={16} /> Teams
        </button>
        <button
          role="tab"
          aria-selected={section === 'people'}
          className={`tab ${section === 'people' ? 'active' : ''}`}
          onClick={() => setSection('people')}
          data-testid="teams-tab-people"
        >
          <UserRound size={16} /> People
        </button>
      </div>

      {section === 'teams' && !canListGroups && caps && (
        <div className="notice warning small" data-testid="teams-gated">
          Your token cannot list identity groups, so teams cannot be shown. {deniedReason(caps, 'identity/group/name', 'list')}
          {' '}Ask an administrator for <code>identity/group/name</code> list access.
        </div>
      )}
      {section === 'people' && !canListUsers && caps && (
        <div className="notice warning small" data-testid="people-gated">
          Your token cannot list userpass users. {deniedReason(caps, 'auth/userpass/users', 'list')}
          {' '}Identity entities may still be readable below.
        </div>
      )}

      {section === 'teams'
        ? <TeamsSection project={project} projects={projects} caps={caps} canList={canListGroups} />
        : <PeopleSection caps={caps} canListUsers={canListUsers} />}
    </div>
  );
}

function TeamsSection({ project, projects, caps, canList }: {
  project: string;
  projects: string[];
  caps: ReturnType<typeof useCapabilities>['data'];
  canList: boolean;
}) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const groups = useGroups();
  const policies = usePolicies();
  const entities = useEntities();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'project' | 'all'>('project');
  const [selected, setSelected] = useState<string | null>(null);
  const [previewPolicy, setPreviewPolicy] = useState<string | null>(null);
  const [showShared, setShowShared] = useState(false);
  const [memberToAdd, setMemberToAdd] = useState('');
  const [busy, setBusy] = useState(false);

  const canWrite = can(caps, 'identity/group/name/__new__', 'create')
    || can(caps, 'identity/group/name/', 'update')
    || can(caps, 'identity/group/name', 'update');

  const parsed = useMemo(
    () => (groups.data ?? []).map((name) => parseTeamName(name, projects)),
    [groups.data, projects],
  );
  const filtered = parsed.filter((team) => {
    if (scope === 'project' && project && team.project && team.project !== project) return false;
    if (scope === 'project' && project && !team.project) return false;
    return matchesSearch([team.name, team.project, team.role], query);
  });
  // Details are fetched only for visible rows, so a 67-group server does not
  // issue 67 reads when the page opens.
  const details = useQueries({
    queries: filtered.slice(0, 80).map((team) => ({
      queryKey: ['identity-group', team.name],
      queryFn: () => bao.readGroup(team.name),
      staleTime: 60_000,
      retry: false,
    })),
  });
  const detailByName = useMemo(() => Object.fromEntries(
    filtered.slice(0, 80).map((team, index) => [team.name, details[index]?.data]),
  ), [filtered, details]);

  const groupQ = useQuery({
    queryKey: ['identity-group', selected],
    queryFn: () => bao.readGroup(selected!),
    enabled: Boolean(selected),
    staleTime: 30_000,
  });
  const group = groupQ.data;

  const members = useQueries({
    queries: (group?.memberEntityIds ?? []).map((id) => ({
      queryKey: ['entity-id', id],
      queryFn: () => bao.readEntityById(id),
      staleTime: 60_000,
      retry: false,
    })),
  });

  const shared = useQuery({
    queryKey: ['identity-group-details', 'all'],
    queryFn: async () => Promise.all((groups.data ?? []).map((name) => bao.readGroup(name))),
    enabled: Boolean(showShared && groups.data?.length),
    staleTime: 60_000,
    retry: false,
  });
  const policyQ = useQuery({
    queryKey: ['acl-policy', previewPolicy],
    queryFn: () => bao.readPolicy(previewPolicy!),
    enabled: Boolean(previewPolicy),
    retry: false,
  });

  const memberNames = new Set(members.map((member) => member.data?.name).filter((name): name is string => Boolean(name)));
  const candidates = (entities.data ?? []).filter((name) => !memberNames.has(name));
  const sharedTeams = teamsSharingPolicy(shared.data ?? [], group ?? { name: '', policies: [] });

  async function writeGroup(next: IdentityGroup, message: string) {
    setBusy(true);
    try {
      await bao.writeGroup({
        name: next.name,
        type: next.type,
        policies: next.policies,
        memberEntityIds: next.memberEntityIds,
      });
      await queryClient.invalidateQueries();
      addToast('success', message, next.name);
    } catch (error) {
      addToast('error', 'Could not update the team', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function addMember() {
    if (!group || !memberToAdd) return;
    try {
      // The picker lists entity names; the group stores entity ids.
      const entity = await bao.readEntity(memberToAdd);
      if (!entity.id) {
        addToast('error', 'Could not resolve that person', 'The entity has no id.');
        return;
      }
      setMemberToAdd('');
      await writeGroup({ ...group, memberEntityIds: [...group.memberEntityIds, entity.id] }, 'Member added');
    } catch (error) {
      addToast('error', 'Could not add the member', error instanceof Error ? error.message : undefined);
    }
  }

  async function removeMember(id: string) {
    if (!group) return;
    await writeGroup({ ...group, memberEntityIds: group.memberEntityIds.filter((member) => member !== id) }, 'Member removed');
  }

  async function savePolicies(selectedPolicies: string[]) {
    if (!group) return;
    await writeGroup({ ...group, policies: selectedPolicies }, 'Team policies saved');
  }

  if (!canList) {
    return <EmptyState icon={<Users size={26} />} title="Teams need group access">Nothing is shown because your token cannot list identity groups.</EmptyState>;
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <FilterBar
        ariaLabel="Team filters"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Filter teams by project or role…',
          label: 'Filter teams',
          testId: 'team-filter',
        }}
        active={scope === 'project' && project ? [{ label: `Project: ${project}`, onClear: () => setScope('all') }] : []}
        onClearAll={() => { setQuery(''); setScope('all'); }}
      >
        <Field label="Scope" htmlFor="team-scope">
          <select id="team-scope" value={scope} onChange={(event) => setScope(event.target.value as 'project' | 'all')} data-testid="team-scope">
            <option value="project">This project ({project || 'none'})</option>
            <option value="all">All groups</option>
          </select>
        </Field>
        <Button
          size="small"
          variant="ghost"
          icon={<RefreshCw size={14} className={groups.isFetching ? 'spin' : ''} />}
          onClick={() => void groups.refetch()}
          disabled={groups.isFetching}
        >
          Refresh
        </Button>
      </FilterBar>

      {groups.isError && <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />}

      <div className="grid grid--split">
        <div className="panel">
          <div className="panel__head">
            <Users size={17} />
            <h3>Teams</h3>
            <Badge size="small">{filtered.length}</Badge>
          </div>
          {groups.isLoading && <div className="state"><div className="spinner" /></div>}
          {!groups.isLoading && filtered.length === 0 && (
            <EmptyState icon={<Users size={24} />} title="No teams match">
              Teams are identity groups. Try “All groups”, or create one from the server with <code>team-&lt;project&gt;-&lt;role&gt;</code>.
            </EmptyState>
          )}
          {filtered.slice(0, 80).map((team) => {
            const detail = detailByName[team.name];
            return (
              <button
                key={team.name}
                className={`list-item ${selected === team.name ? 'selected' : ''}`}
                onClick={() => { setSelected(team.name); setShowShared(false); }}
                data-testid={`team-${team.name}`}
              >
                <Users size={16} />
                <span className="list-item__main">
                  <span className="list-item__title">{team.role || team.name}</span>
                  <span className="list-item__sub mono">{team.name}</span>
                </span>
                <span className="list-item__count">
                  {detail ? `${detail.memberEntityIds.length} member${detail.memberEntityIds.length === 1 ? '' : 's'}` : '…'}
                </span>
              </button>
            );
          })}
          {filtered.length > 80 && <p className="small muted" style={{ padding: '0 var(--spacing-md)' }}>Showing the first 80 teams. Filter to narrow the list.</p>}
        </div>

        <div className="panel">
          <div className="panel__head">
            <ShieldCheck size={17} />
            <h3>{group ? group.name : 'Select a team'}</h3>
            {group && <Badge size="small" variant={group.type === 'external' ? 'outline' : 'success'}>{group.type}</Badge>}
          </div>
          <div className="panel__body">
            {!selected && <p className="muted">Choose a team to see its members and policies.</p>}
            {groupQ.isLoading && <div className="state"><div className="spinner" /></div>}
            {groupQ.isError && <ErrorState error={groupQ.error} onRetry={() => void groupQ.refetch()} />}
            {group && (
              <div className="grid" style={{ gap: '1rem' }}>
                <div>
                  <div className="section-title">Policies</div>
                  {policyList(group.policies)}
                  <p className="small muted">Every member inherits these ACL policies. Policies are shared, so another team with the same policy has the same access.</p>
                  <div className="method-chips">
                    {group.policies.map((policy) => (
                      <button key={policy} className="link-btn small" onClick={() => setPreviewPolicy(policy)}>
                        Preview {policy}
                      </button>
                    ))}
                    <Button size="small" variant="ghost" onClick={() => setShowShared(true)} disabled={shared.isFetching}>
                      Who else has this role?
                    </Button>
                  </div>
                  {showShared && (
                    <div className="notice small" data-testid="shared-teams">
                      {shared.isLoading && 'Looking for teams with an overlapping policy…'}
                      {!shared.isLoading && sharedTeams.length === 0 && 'No other team shares one of these policies.'}
                      {sharedTeams.map((team) => (
                        <button key={team.name} className="link-btn mono small" style={{ display: 'block' }} onClick={() => setSelected(team.name)}>
                          {team.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="section-title">Members <Badge size="small">{group.memberEntityIds.length}</Badge></div>
                  {members.map((member, index) => {
                    const entity = member.data;
                    const id = group.memberEntityIds[index];
                    return (
                      <div className="list-item" key={id} data-testid={`team-member-${id}`}>
                        <UserRound size={15} />
                        <span className="list-item__main">
                          <span className="list-item__title">{entity?.name ?? id}</span>
                          <span className="list-item__sub mono">{id}</span>
                        </span>
                        {entity && entity.aliases?.length ? <span className="small muted">{entity.aliases.map((alias) => alias.mountType).filter(Boolean).join(', ')}</span> : null}
                        <button
                          className="icon-btn"
                          onClick={() => void removeMember(id)}
                          disabled={!canWrite || group.type === 'external' || busy}
                          title={group.type === 'external' ? 'External groups are managed by the identity provider' : canWrite ? 'Remove this member' : 'Your token cannot update groups'}
                          aria-label={`Remove ${entity?.name ?? id}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                  {group.memberEntityIds.length === 0 && <p className="small muted">No members yet.</p>}
                  <div className="field" style={{ marginTop: '0.6rem' }}>
                    <label htmlFor="team-member">Add a person</label>
                    <div className="row-inline">
                      <select id="team-member" value={memberToAdd} onChange={(event) => setMemberToAdd(event.target.value)} disabled={!canWrite || group.type === 'external'}>
                        <option value="">Choose an entity…</option>
                        {candidates.map((name) => <option key={name} value={name}>{name}</option>)}
                      </select>
                      <Button size="small" icon={<Plus size={14} />} onClick={() => void addMember()} disabled={!memberToAdd || !canWrite || group.type === 'external'} loading={busy}>
                        Add
                      </Button>
                    </div>
                  </div>
                  {group.type === 'external' && <p className="small muted">External groups come from OIDC/LDAP and are read-only here.</p>}
                  {!canWrite && <p className="small muted">Your token cannot update identity groups.</p>}
                </div>

                <PolicyEditor
                  key={`${group.name}:${group.policies.join(',')}`}
                  group={group}
                  policies={policies.data ?? []}
                  canWrite={canWrite && group.type !== 'external'}
                  onSave={savePolicies}
                  busy={busy}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {previewPolicy && (
        <Dialog title={`Policy ${previewPolicy}`} onClose={() => setPreviewPolicy(null)} testId="policy-preview">
          {policyQ.isLoading && <div className="state"><div className="spinner" /></div>}
          {policyQ.isError && <ErrorState error={policyQ.error} onRetry={() => void policyQ.refetch()} />}
          {policyQ.data && <pre className="hcl-preview mono small">{policyQ.data.data.policy}</pre>}
          <p className="small muted">Read-only ACL policy. This preview contains rules, never secret values.</p>
        </Dialog>
      )}
    </div>
  );
}

function PolicyEditor({ group, policies, canWrite, onSave, busy }: {
  group: IdentityGroup;
  policies: string[];
  canWrite: boolean;
  onSave: (policies: string[]) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<string[]>(group.policies);
  const [filter, setFilter] = useState('');
  const visible = policies.filter((policy) => matchesSearch([policy], filter));

  return (
    <details className="panel">
      <summary className="panel__head" style={{ cursor: 'pointer' }}>
        <ShieldCheck size={15} />
        <h3 style={{ fontSize: '0.95rem' }}>Attach policies</h3>
      </summary>
      <div className="panel__body grid" style={{ gap: '0.5rem' }}>
        <div className="search">
          <Search size={14} />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter policies…" aria-label="Filter policies" />
        </div>
        <div className="policy-checklist">
          {visible.map((policy) => (
            <label key={policy} className="check-row">
              <input
                type="checkbox"
                checked={draft.includes(policy)}
                disabled={!canWrite}
                onChange={(event) => setDraft((current) => (
                  event.target.checked ? [...current, policy] : current.filter((item) => item !== policy)
                ))}
              />
              <span className="mono">{policy}</span>
            </label>
          ))}
          {visible.length === 0 && <p className="small muted">No policies match.</p>}
        </div>
        {canWrite ? (
          <Button size="small" icon={<Check size={14} />} onClick={() => void onSave(draft)} loading={busy}>
            Save policies
          </Button>
        ) : (
          <p className="small muted">Read-only. Your token cannot update this group.</p>
        )}
      </div>
    </details>
  );
}

function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

function PeopleSection({ caps, canListUsers }: {
  caps: ReturnType<typeof useCapabilities>['data'];
  canListUsers: boolean;
}) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const users = useUserpassUsers();
  const entities = useEntities();
  const policies = usePolicies();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ kind: 'user' | 'entity'; name: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [chosenPolicies, setChosenPolicies] = useState<string[]>(['default']);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const canWriteUsers = can(caps, 'auth/userpass/users/__new__', 'create')
    || can(caps, 'auth/userpass/users/', 'update')
    || can(caps, 'auth/userpass/users', 'update');

  const userQ = useQuery({
    queryKey: ['userpass-user', selected?.kind === 'user' ? selected.name : undefined],
    queryFn: () => bao.readUserpassUser(selected!.name),
    enabled: selected?.kind === 'user',
    retry: false,
  });
  const entityQ = useQuery({
    queryKey: ['entity', selected?.kind === 'entity' ? selected.name : undefined],
    queryFn: () => bao.readEntity(selected!.name),
    enabled: selected?.kind === 'entity',
    retry: false,
  });
  const memberships = useQuery({
    queryKey: ['identity-group-details', 'people'],
    queryFn: async () => Promise.all((await bao.listGroups()).map((name) => bao.readGroup(name))),
    enabled: Boolean(selected && entityQ.data?.id),
    staleTime: 60_000,
    retry: false,
  });
  const myTeams = (memberships.data ?? []).filter((group) => (
    entityQ.data?.id ? group.memberEntityIds.includes(entityQ.data.id) : false
  ));

  const userList = (users.data ?? []).filter((name) => matchesSearch([name], query));
  const entityList = (entities.data ?? []).filter((name) => matchesSearch([name], query));

  function openCreate() {
    setUsername('');
    setPassword(randomPassword());
    setChosenPolicies(['default']);
    setCreateError(null);
    setCreateOpen(true);
  }

  async function createUser() {
    const name = username.trim();
    if (!/^[A-Za-z0-9._-]{2,64}$/.test(name)) {
      setCreateError('Use 2–64 letters, numbers, dot, dash or underscore.');
      return;
    }
    if (password.length < 8) {
      setCreateError('Use a temporary password of at least 8 characters.');
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      await bao.writeUserpassUser(name, password, chosenPolicies);
      await queryClient.invalidateQueries();
      setCreateOpen(false);
      // Hold the password only until the show-once dialog is dismissed.
      setCreated({ username: name, password });
      setPassword('');
      addToast('success', 'User created', `${name} can sign in with the temporary password shown once.`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create the user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <FilterBar
        ariaLabel="People filters"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Filter people…',
          label: 'Filter people',
          testId: 'people-filter',
        }}
        actions={(
          <Button size="small" icon={<Plus size={14} />} onClick={openCreate} disabled={!canWriteUsers} title={canWriteUsers ? 'Create a userpass user' : 'Your token cannot create users'} data-testid="create-person">
            Add person
          </Button>
        )}
      />

      {users.isError && <ErrorState error={users.error} onRetry={() => void users.refetch()} />}

      <div className="grid grid--split">
        <div className="panel">
          <div className="panel__head"><UserRound size={17} /><h3>Userpass users</h3><Badge size="small">{userList.length}</Badge></div>
          {users.isLoading && <div className="state"><div className="spinner" /></div>}
          {!users.isLoading && userList.length === 0 && <EmptyState title="No userpass users">Users created here can sign in with a username and password.</EmptyState>}
          {userList.map((name) => (
            <button
              key={name}
              className={`list-item ${selected?.kind === 'user' && selected.name === name ? 'selected' : ''}`}
              onClick={() => setSelected({ kind: 'user', name })}
              data-testid={`person-user-${name}`}
            >
              <KeyRound size={15} />
              <span className="list-item__main"><span className="list-item__title">{name}</span></span>
            </button>
          ))}
          <div className="divider" />
          <div className="panel__head"><Users size={15} /><h3 style={{ fontSize: '0.95rem' }}>Identity entities</h3><Badge size="small">{entityList.length}</Badge></div>
          {entityList.slice(0, 80).map((name) => (
            <button
              key={name}
              className={`list-item ${selected?.kind === 'entity' && selected.name === name ? 'selected' : ''}`}
              onClick={() => setSelected({ kind: 'entity', name })}
              data-testid={`person-entity-${name}`}
            >
              <UserRound size={15} />
              <span className="list-item__main"><span className="list-item__title">{name}</span></span>
            </button>
          ))}
          {entityList.length > 80 && <p className="small muted" style={{ padding: '0 var(--spacing-md)' }}>Showing the first 80 entities. Filter to narrow the list.</p>}
        </div>

        <div className="panel">
          <div className="panel__head"><UserRound size={17} /><h3>{selected?.name ?? 'Select a person'}</h3></div>
          <div className="panel__body">
            {!selected && <p className="muted">Choose a user or entity to see policies, aliases and team membership.</p>}
            {selected?.kind === 'user' && userQ.isLoading && <div className="state"><div className="spinner" /></div>}
            {selected?.kind === 'user' && userQ.isError && <ErrorState error={userQ.error} onRetry={() => void userQ.refetch()} />}
            {selected?.kind === 'user' && userQ.data && (
              <div className="grid" style={{ gap: '0.75rem' }}>
                <div><div className="section-title">Policies</div>{policyList(userQ.data.policies)}</div>
                <p className="small muted">
                  Userpass stores the password hash server-side; the console never reads it. Team membership follows the
                  person's identity entity after their first sign-in.
                </p>
              </div>
            )}
            {selected?.kind === 'entity' && entityQ.isLoading && <div className="state"><div className="spinner" /></div>}
            {selected?.kind === 'entity' && entityQ.isError && <ErrorState error={entityQ.error} onRetry={() => void entityQ.refetch()} />}
            {selected?.kind === 'entity' && entityQ.data && (
              <div className="grid" style={{ gap: '0.75rem' }}>
                <div><div className="section-title">Policies</div>{policyList(entityQ.data.policies)}</div>
                <div>
                  <div className="section-title">Aliases</div>
                  {(entityQ.data.aliases ?? []).length === 0 && <p className="small muted">No aliases. This entity cannot sign in through an auth method.</p>}
                  {(entityQ.data.aliases ?? []).map((alias) => (
                    <div className="list-item" key={`${alias.mountAccessor}-${alias.name}`}>
                      <ExternalLink size={14} />
                      <span className="list-item__main"><span className="list-item__title">{alias.name}</span></span>
                      <span className="small muted">{alias.mountType}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="section-title">Teams</div>
                  {memberships.isLoading && <p className="small muted">Looking up teams…</p>}
                  {!memberships.isLoading && myTeams.length === 0 && <p className="small muted">Not a member of any team.</p>}
                  {myTeams.map((team) => <span className="method-chip" key={team.name}><code>{team.name}</code></span>)}
                </div>
                <p className="small muted">Effective access combines these entity policies with the policies on each team the person belongs to.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {createOpen && (
        <Dialog
          title="Add a person"
          testId="create-person-dialog"
          onClose={() => { setCreateOpen(false); setPassword(''); }}
          footer={
            <>
              <Button variant="outlined" onClick={() => { setCreateOpen(false); setPassword(''); }}>Cancel</Button>
              <Button icon={<Plus size={15} />} onClick={() => void createUser()} loading={busy}>Create user</Button>
            </>
          }
        >
          <p className="small muted">Creates a userpass user. The temporary password is shown once after creation and is never stored by the console.</p>
          <Field label="Username" htmlFor="person-username">
            <input id="person-username" className="mono" value={username} onChange={(event) => { setUsername(event.target.value); setCreateError(null); }} autoFocus placeholder="e.g. sam.taylor" />
          </Field>
          <Field label="Temporary password" htmlFor="person-password" hint="Shown once. Ask the person to change it after signing in.">
            <div className="row-inline">
              <input id="person-password" className="mono" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" spellCheck={false} />
              <Button size="small" variant="outlined" onClick={() => setPassword(randomPassword())}>Generate</Button>
            </div>
          </Field>
          <div className="field">
            <label>Policies</label>
            <div className="policy-checklist">
              {(policies.data ?? []).map((policy) => (
                <label key={policy} className="check-row">
                  <input
                    type="checkbox"
                    checked={chosenPolicies.includes(policy)}
                    onChange={(event) => setChosenPolicies((current) => (
                      event.target.checked ? [...current, policy] : current.filter((item) => item !== policy)
                    ))}
                  />
                  <span className="mono">{policy}</span>
                </label>
              ))}
            </div>
          </div>
          {createError && <div className="notice error small" role="alert">{createError}</div>}
        </Dialog>
      )}

      {created && (
        <Dialog
          title="Temporary password (shown once)"
          testId="created-person-dialog"
          onClose={() => setCreated(null)}
          footer={<Button onClick={() => setCreated(null)}>I saved it</Button>}
        >
          <p className="small muted">
            Give this password to <span className="mono">{created.username}</span> through a secure channel. It will not be
            shown again, and the console has already discarded it.
          </p>
          <div className="row-inline">
            <code className="mono share-token" data-testid="created-person-password">{created.password}</code>
            <CopyButton value={created.password} label="Copy password" />
          </div>
          <div className="notice warning small">Changing the password later is a normal userpass write and is recorded in the audit log.</div>
        </Dialog>
      )}

      {!canListUsers && (
        <p className="small muted">Userpass users are hidden because your token cannot list them. Identity entities may still be available.</p>
      )}
    </div>
  );
}
