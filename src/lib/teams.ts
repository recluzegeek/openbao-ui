/**
 * Teams are OpenBao identity groups. The `team-<project>-<role>` name is a
 * convention from the migrated data, not a requirement: any group is shown,
 * and unmatched names are treated as a plain team.
 */
export interface ParsedTeam {
  name: string;
  project: string;
  role: string;
  /** True when the name follows the `team-<project>-<role>` convention. */
  conventional: boolean;
}

export function parseTeamName(name: string, projects: string[]): ParsedTeam {
  if (!name.startsWith('team-')) return { name, project: '', role: name, conventional: false };
  const rest = name.slice('team-'.length);
  // Longest match first so `team-acme-eu-leads` parses project `acme-eu`,
  // not project `acme` with role `eu-leads`.
  const project = [...projects]
    .sort((a, b) => b.length - a.length)
    .find((candidate) => rest === candidate || rest.startsWith(`${candidate}-`));
  if (!project) return { name, project: '', role: rest, conventional: false };
  return {
    name,
    project,
    role: rest.slice(project.length + 1) || 'members',
    conventional: true,
  };
}

/** Teams that share at least one policy have the same effective access. */
export function teamsSharingPolicy(
  teams: Array<{ name: string; policies: string[] }>,
  team: { name: string; policies: string[] },
): Array<{ name: string; policies: string[] }> {
  return teams.filter((candidate) => (
    candidate.name !== team.name
    && candidate.policies.some((policy) => team.policies.includes(policy))
  ));
}
