import { useState } from 'react';
import { FileCode2, Layers3, Save } from 'lucide-react';
import { bao } from '@/lib/api';
import type { ClassifiedSecret, LayoutProfile } from '@/lib/layout';
import {
  generateHcl,
  ROLE_TEMPLATES,
  templateRules,
  templateRulesFromLayout,
  type PolicyRule,
  type RoleTemplateId,
} from '@/lib/policy';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet } from '@/components/common/Extras';

interface RoleTemplatesProps {
  project: string;
  env: string;
  canWrite: boolean;
  policies: string[];
  profile?: LayoutProfile;
  classified?: ClassifiedSecret[];
  roleNames?: Partial<Record<RoleTemplateId, string>>;
  onLoadTemplate: (name: string, rules: PolicyRule[], raw?: string) => void;
  onOpenPolicy: (name: string) => void;
  onSaved: () => void;
}

function policyName(project: string, env: string, template: RoleTemplateId): string {
  return env === '*' ? `${project}-${template}` : `${project}-${env}-${template}`;
}

export function RoleTemplates({
  project, env, canWrite, policies, profile, classified = [], roleNames, onLoadTemplate, onOpenPolicy, onSaved,
}: RoleTemplatesProps) {
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState<RoleTemplateId | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function write(name: string, rules: PolicyRule[]) {
    setBusy(name);
    try {
      await bao.writePolicy(name, generateHcl(rules));
      addToast('success', `Wrote ${name}`, 'The ACL policy is now live in OpenBao.');
      onSaved();
    } catch (error) {
      addToast('error', 'Policy write failed', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="panel">
        <div className="panel__head">
          <Layers3 size={17} />
          <h3>Role templates</h3>
          <span className="small muted">Scoped to {project} · {env === '*' ? 'all environments' : env}</span>
        </div>
        <div className="panel__body grid role-grid">
          {ROLE_TEMPLATES.map((template) => {
            const name = roleNames?.[template.id] ?? policyName(project, env, template.id);
            const rules = profile
              ? templateRulesFromLayout(template.id, project, env, profile, classified)
              : templateRules(template.id, project, env);
            const exists = policies.includes(name);
            const isOpen = expanded === template.id;
            return (
              <div className="role-card" key={template.id} data-testid={`role-template-${template.id}`}>
                <div className="role-card__head">
                  <strong>{template.label}</strong>
                  {exists && <Badge size="small" variant="success">live</Badge>}
                </div>
                <p className="small muted">{template.blurb}</p>
                <div className="role-card__stats">
                  <span><Badge size="small" variant="outline">{rules.length} rules</Badge></span>
                  <span className="small muted mono">{name}</span>
                </div>
                <div className="role-card__actions">
                  <Button size="small" variant="ghost" icon={<FileCode2 size={14} />} onClick={() => setExpanded(isOpen ? null : template.id)}>
                    {isOpen ? 'Hide HCL' : 'Preview HCL'}
                  </Button>
                  <Button size="small" variant="outlined" onClick={() => onLoadTemplate(name, rules)}>Open in builder</Button>
                  <Button
                    size="small"
                    icon={<Save size={14} />}
                    disabled={!canWrite || busy === name}
                    loading={busy === name}
                    onClick={() => void write(name, rules)}
                    data-testid={`write-${template.id}`}
                  >
                    {exists ? 'Update' : 'Write policy'}
                  </Button>
                </div>
                {isOpen && <CodeSnippet text={generateHcl(rules)} label={`${name} HCL`} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head"><h3>Project policies in OpenBao</h3><Badge size="small">{policies.length}</Badge></div>
        <div className="panel__body">
          {policies.length === 0 && <p className="muted">No ACL policies for this project yet. Write a template above to create one.</p>}
          {policies.map((name) => (
            <div className="list-item" key={name} data-testid={`policy-${name}`}>
              <span className="list-item__main">
                <span className="list-item__title mono">{name}</span>
                <span className="list-item__sub">ACL policy · click to edit in the visual builder</span>
              </span>
              <Button size="small" variant="outlined" onClick={() => onOpenPolicy(name)}>Open</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
