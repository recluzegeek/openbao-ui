import { useEffect, useState } from 'react';
import { CodeXml, FileCode2, Plus, Save, Trash2 } from 'lucide-react';
import { bao } from '@/lib/api';
import { CAPABILITY_ORDER, generateHcl, orderCapabilities, parseHcl, type PolicyRule } from '@/lib/policy';
import { useToast } from '@/lib/toast';
import { Badge } from '@/components/common/Badge';
import { Button } from '@/components/common/Button';
import { CodeSnippet } from '@/components/common/Extras';

interface PolicyBuilderProps {
  project: string;
  name: string;
  rules: PolicyRule[];
  initialHcl?: string;
  canWrite: boolean;
  existingPolicies: string[];
  onNameChange: (name: string) => void;
  onRulesChange: (rules: PolicyRule[]) => void;
  onSaved: () => void;
}

export function PolicyBuilder({
  project, name, rules, initialHcl, canWrite, existingPolicies, onNameChange, onRulesChange, onSaved,
}: PolicyBuilderProps) {
  const { addToast } = useToast();
  const [mode, setMode] = useState<'visual' | 'hcl'>(initialHcl === undefined ? 'visual' : 'hcl');
  const [hcl, setHcl] = useState(() => initialHcl ?? generateHcl(rules));
  const [hclError, setHclError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialHcl === undefined) return;
    setMode('hcl');
    setHcl(initialHcl);
    const parsed = parseHcl(initialHcl);
    setHclError(parsed.error ?? null);
  }, [initialHcl]);

  function switchMode(next: 'visual' | 'hcl') {
    setSaveError(null);
    if (next === 'hcl') {
      setHcl(generateHcl(rules));
      setHclError(null);
      setMode('hcl');
      return;
    }
    const parsed = parseHcl(hcl);
    if (parsed.error) {
      setHclError(parsed.error);
      return;
    }
    setHclError(null);
    onRulesChange(parsed.rules);
    setMode('visual');
  }

  function updateRule(index: number, patch: Partial<PolicyRule>) {
    onRulesChange(rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  }

  function toggleCapability(index: number, capability: string) {
    const current = rules[index].capabilities;
    updateRule(index, {
      capabilities: orderCapabilities(current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability]),
    });
  }

  function currentRules(): PolicyRule[] | null {
    if (mode === 'visual') return rules;
    const parsed = parseHcl(hcl);
    if (parsed.error) { setHclError(parsed.error); return null; }
    return parsed.rules;
  }

  async function save() {
    const effective = currentRules();
    if (!effective) return;
    const policyName = name.trim();
    if (!policyName || !/^[\w.-]+$/.test(policyName)) {
      setSaveError('Policy name may only contain letters, numbers, dots, dashes and underscores.');
      return;
    }
    if (effective.length === 0 || effective.some((rule) => !rule.path.trim() || rule.capabilities.length === 0)) {
      setSaveError('Every rule needs a path and at least one capability.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await bao.writePolicy(policyName, mode === 'hcl' ? hcl : generateHcl(effective));
      addToast('success', `Saved ${policyName}`, effective.length ? `${effective.length} path rules are now live.` : undefined);
      onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const preview = mode === 'visual' ? generateHcl(rules) : hcl;

  return (
    <div className="grid" style={{ gap: '1rem' }}>
      <div className="panel">
        <div className="panel__head">
          <FileCode2 size={17} />
          <h3>Policy builder</h3>
          <span className="small muted">Design path rules, then review the exact HCL OpenBao receives</span>
        </div>
        <div className="panel__body grid" style={{ gap: '1rem' }}>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="policy-name">Policy name</label>
              <input
                id="policy-name"
                className="mono"
                value={name}
                list="known-policies"
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={`${project}-viewer`}
              />
              <datalist id="known-policies">
                {existingPolicies.map((item) => <option value={item} key={item} />)}
              </datalist>
            </div>
            <div className="field">
              <label>Mode</label>
              <div className="env-switch" role="group" aria-label="Builder mode">
                <button aria-pressed={mode === 'visual'} onClick={() => switchMode('visual')}><CodeXml size={14} /> Visual rules</button>
                <button aria-pressed={mode === 'hcl'} onClick={() => switchMode('hcl')}><FileCode2 size={14} /> HCL</button>
              </div>
            </div>
          </div>

          {mode === 'visual' ? (
            <div className="rule-list" data-testid="policy-rules">
              <div className="rule-row rule-row--head">
                <span>Path pattern</span>
                <span>Capabilities</span>
                <span />
              </div>
              {rules.map((rule, index) => (
                <div className="rule-row" key={`${index}-${rule.path}`} data-testid={`policy-rule-${index}`}>
                  <input
                    className="mono"
                    aria-label={`Path pattern ${index + 1}`}
                    value={rule.path}
                    onChange={(event) => updateRule(index, { path: event.target.value })}
                    placeholder="kv/data/project/env/*"
                  />
                  <div className="rule-row__caps">
                    {CAPABILITY_ORDER.map((capability) => (
                      <label key={capability} className={`cap-check ${rule.capabilities.includes(capability) ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={rule.capabilities.includes(capability)}
                          onChange={() => toggleCapability(index, capability)}
                          aria-label={`${capability} on ${rule.path || 'rule'}`}
                        />
                        {capability}
                      </label>
                    ))}
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() => onRulesChange(rules.filter((_, position) => position !== index))}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <Button
                size="small"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => onRulesChange([...rules, { path: `kv/data/${project}/env/*`, capabilities: ['read'] }])}
              >
                Add path rule
              </Button>
              {rules.length === 0 && <p className="small muted">No rules yet. Add one or switch to HCL and paste a policy.</p>}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="policy-hcl">HCL policy</label>
              <textarea
                id="policy-hcl"
                className="mono policy-hcl"
                rows={14}
                spellCheck={false}
                value={hcl}
                onChange={(event) => { setHcl(event.target.value); setHclError(null); }}
              />
              <p className="small muted">Supports <code>path "…" {'{'} capabilities = ["…"] {'}'}</code> blocks. Comments are preserved when you save in HCL mode.</p>
            </div>
          )}

          {(hclError || saveError) && <div className="notice error small" role="alert">{hclError || saveError}</div>}

          <div>
            <div className="section-title">HCL preview <Badge size="small" variant="outline">{mode === 'hcl' ? 'editing' : 'generated'}</Badge></div>
            {mode === 'hcl' ? (
              <p className="small muted">The text above is what will be saved.</p>
            ) : (
              <CodeSnippet text={preview} label="Policy HCL" />
            )}
          </div>

          <div className="panel-actions">
            <Button icon={<Save size={15} />} onClick={() => void save()} disabled={!canWrite || saving} loading={saving} data-testid="save-policy">
              Save policy
            </Button>
            {!canWrite && <span className="small muted">Your token cannot write ACL policies.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
