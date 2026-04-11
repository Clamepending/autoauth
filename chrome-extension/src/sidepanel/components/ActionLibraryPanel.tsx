import { useMemo, useState } from 'react';
import type { AgentMacroAction, AgentMacroParameter, AgentMacroStep } from '../../shared/types';
import {
  createBlankMacroDraft,
  createBlankMacroParameter,
  createBlankMacroStep,
  deleteAgentMacro,
  getMacroGroups,
  getPrimitiveAction,
  getPrimitiveActions,
  isBuiltInMacro,
  isRemoteMacro,
  labelFromDomain,
  normalizeDomainPattern,
  saveAgentMacro,
  type AgentMacroDraft,
} from '../agent/actionLibrary';
import { useStore } from '../store';

function prettyJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function parameterPlaceholder(parameter: AgentMacroParameter): string {
  return `{{${parameter.name || 'param'}}}`;
}

function stepSummary(step: AgentMacroStep): string {
  return getPrimitiveAction(step.primitiveId)?.label || step.primitiveId;
}

function scopeSummary(macro: AgentMacroAction): string {
  return macro.scope.type === 'global'
    ? 'Available on all websites'
    : `Appears on ${macro.scope.domainPattern}`;
}

function formatMacroDraft(macro: AgentMacroAction): AgentMacroDraft {
  return {
    id: macro.id,
    name: macro.name,
    description: macro.description,
    scope: { ...macro.scope },
    parameters: macro.parameters.map((parameter) => ({ ...parameter })),
    steps: macro.steps.map((step) => ({ ...step, input: JSON.parse(JSON.stringify(step.input)) as Record<string, unknown> })),
  };
}

function buildStepJsonMap(steps: AgentMacroStep[]): Record<string, string> {
  return Object.fromEntries(steps.map((step) => [step.id, prettyJson(step.input)]));
}

function sanitizeParameterName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseStepInputJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Step settings must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function stepJsonError(value: string): string | null {
  try {
    parseStepInputJson(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid JSON';
  }
}

export default function ActionLibraryPanel() {
  const macros = useStore((state) => state.actionMacros);
  const primitiveActions = useMemo(() => getPrimitiveActions(), []);
  const macroGroups = useMemo(() => getMacroGroups(macros), [macros]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentMacroDraft>(createBlankMacroDraft());
  const [stepJson, setStepJson] = useState<Record<string, string>>(buildStepJsonMap(draft.steps));

  const openNewMacro = () => {
    const nextDraft = createBlankMacroDraft();
    setDraft(nextDraft);
    setStepJson(buildStepJsonMap(nextDraft.steps));
    setEditingMacroId(null);
    setEditorError('');
    setEditorOpen(true);
  };

  const openEditMacro = (macro: AgentMacroAction) => {
    const nextDraft = formatMacroDraft(macro);
    setDraft(nextDraft);
    setStepJson(buildStepJsonMap(nextDraft.steps));
    setEditingMacroId(macro.id);
    setEditorError('');
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorError('');
    setEditorOpen(false);
    setEditingMacroId(null);
  };

  const updateDraft = (updater: (current: AgentMacroDraft) => AgentMacroDraft) => {
    setDraft((current) => updater(current));
  };

  const updateParameter = (
    parameterId: string,
    updater: (parameter: AgentMacroParameter) => AgentMacroParameter,
  ) => {
    updateDraft((current) => ({
      ...current,
      parameters: current.parameters.map((parameter) => (
        parameter.id === parameterId ? updater(parameter) : parameter
      )),
    }));
  };

  const updateStep = (stepId: string, updater: (step: AgentMacroStep) => AgentMacroStep) => {
    updateDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? updater(step) : step)),
    }));
  };

  const saveDraft = async () => {
    setEditorError('');

    try {
      if (!draft.name.trim()) {
        throw new Error('Give the macro a name.');
      }

      const parsedSteps = draft.steps.map((step, index) => {
        const rawJson = stepJson[step.id] || '{}';
        try {
          return {
            ...step,
            input: parseStepInputJson(rawJson),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid JSON';
          throw new Error(`Step ${index + 1}: ${message}`);
        }
      });

      const scope = draft.scope.type === 'global'
        ? { type: 'global' as const, label: 'All websites' }
        : {
          type: 'domain' as const,
          label: draft.scope.label.trim() || labelFromDomain(draft.scope.domainPattern || ''),
          domainPattern: normalizeDomainPattern(draft.scope.domainPattern || ''),
        };

      if (scope.type === 'domain' && !scope.domainPattern) {
        throw new Error('Add a domain like amazon.com for a site-specific macro.');
      }

      const parameters = draft.parameters.map((parameter, index) => ({
        ...parameter,
        name: sanitizeParameterName(parameter.name || `param_${index + 1}`),
        description: parameter.description.trim(),
        defaultValue: parameter.defaultValue?.trim() || '',
      }));

      setIsSaving(true);
      await saveAgentMacro({
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        scope,
        parameters,
        steps: parsedSteps,
      });
      setIsSaving(false);
      closeEditor();
    } catch (error) {
      setIsSaving(false);
      setEditorError(error instanceof Error ? error.message : 'Failed to save macro.');
    }
  };

  const removeMacro = async (macroId: string) => {
    await deleteAgentMacro(macroId);
    if (editingMacroId === macroId) {
      closeEditor();
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Action Library</div>
            <p className="mt-1 text-xs text-gray-500 max-w-[320px]">
              Primitive browser actions live in the global group. Site macros become real agent tools when the active tab matches their domain.
            </p>
          </div>
          <button
            onClick={openNewMacro}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-black"
          >
            New Macro
          </button>
        </div>

        {editorOpen && (
          <div className="border-b border-gray-100 bg-slate-50 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900">
                {editingMacroId ? 'Edit Macro' : 'Create Macro'}
              </div>
              <button
                onClick={closeEditor}
                className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white hover:text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Name</div>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Checkout flow"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Scope</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => updateDraft((current) => ({
                        ...current,
                        scope: { type: 'global', label: 'All websites' },
                      }))}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                        draft.scope.type === 'global'
                          ? 'border-gray-900 bg-gray-900 text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      All websites
                    </button>
                    <button
                      onClick={() => updateDraft((current) => ({
                        ...current,
                        scope: {
                          type: 'domain',
                          label: current.scope.type === 'domain' ? current.scope.label : '',
                          domainPattern: current.scope.type === 'domain' ? current.scope.domainPattern : '',
                        },
                      }))}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium ${
                        draft.scope.type === 'domain'
                          ? 'border-orange-600 bg-orange-600 text-white'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      Site-specific
                    </button>
                  </div>
                </label>
              </div>

              <label className="space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Description</div>
                <textarea
                  value={draft.description}
                  onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Use this when the agent should finish Amazon checkout after the cart is ready."
                  rows={2}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </label>

              {draft.scope.type === 'domain' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Group Label</div>
                    <input
                      type="text"
                      value={draft.scope.label}
                      onChange={(event) => updateDraft((current) => ({
                        ...current,
                        scope: {
                          ...current.scope,
                          type: 'domain',
                          label: event.target.value,
                          domainPattern: current.scope.type === 'domain' ? current.scope.domainPattern : '',
                        },
                      }))}
                      placeholder="Amazon"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                  </label>
                  <label className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Domain</div>
                    <input
                      type="text"
                      value={draft.scope.domainPattern || ''}
                      onChange={(event) => {
                        const nextDomain = normalizeDomainPattern(event.target.value);
                        updateDraft((current) => ({
                          ...current,
                          scope: {
                            ...current.scope,
                            type: 'domain',
                            label: current.scope.type === 'domain' && current.scope.label ? current.scope.label : labelFromDomain(nextDomain || 'site'),
                            domainPattern: nextDomain,
                          },
                        }));
                      }}
                      placeholder="amazon.com"
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                    />
                  </label>
                </div>
              )}

              <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-900">Parameters</div>
                    <div className="text-[11px] text-gray-500">
                      Use placeholders like <code className="rounded bg-gray-100 px-1 py-0.5">{"{{query}}"}</code> or chain a previous step with <code className="rounded bg-gray-100 px-1 py-0.5">{"{{last_ref}}"}</code>.
                    </div>
                  </div>
                  <button
                    onClick={() => updateDraft((current) => ({
                      ...current,
                      parameters: [...current.parameters, createBlankMacroParameter()],
                    }))}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Add Parameter
                  </button>
                </div>

                {draft.parameters.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-[11px] text-gray-500">
                    No parameters yet. You can still use the built-in <code className="rounded bg-white px-1 py-0.5">{"{{tabId}}"}</code> placeholder.
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {draft.parameters.map((parameter) => (
                      <div key={parameter.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.3fr_0.9fr_auto]">
                          <input
                            type="text"
                            value={parameter.name}
                            onChange={(event) => updateParameter(parameter.id, (current) => ({
                              ...current,
                              name: sanitizeParameterName(event.target.value),
                            }))}
                            placeholder="query"
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                          />
                          <select
                            value={parameter.type}
                            onChange={(event) => updateParameter(parameter.id, (current) => ({
                              ...current,
                              type: event.target.value as AgentMacroParameter['type'],
                            }))}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                          </select>
                          <button
                            onClick={() => updateDraft((current) => ({
                              ...current,
                              parameters: current.parameters.filter((entry) => entry.id !== parameter.id),
                            }))}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                          <input
                            type="text"
                            value={parameter.description}
                            onChange={(event) => updateParameter(parameter.id, (current) => ({
                              ...current,
                              description: event.target.value,
                            }))}
                            placeholder="Search term the agent should enter"
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                          />
                          <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={parameter.required}
                              onChange={(event) => updateParameter(parameter.id, (current) => ({
                                ...current,
                                required: event.target.checked,
                              }))}
                            />
                            Required
                          </label>
                        </div>
                        <input
                          type="text"
                          value={parameter.defaultValue || ''}
                          onChange={(event) => updateParameter(parameter.id, (current) => ({
                            ...current,
                            defaultValue: event.target.value,
                          }))}
                          placeholder="Optional default value"
                          className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                        />
                        <div className="mt-2 text-[11px] text-gray-500">
                          Placeholder: <code className="rounded bg-white px-1 py-0.5">{parameterPlaceholder(parameter)}</code>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-gray-900">Steps</div>
                    <div className="text-[11px] text-gray-500">
                      Each step maps to a primitive action with JSON settings. The agent can call the whole macro as one tool.
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const nextStep = createBlankMacroStep();
                      updateDraft((current) => ({ ...current, steps: [...current.steps, nextStep] }));
                      setStepJson((current) => ({ ...current, [nextStep.id]: prettyJson(nextStep.input) }));
                    }}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Add Step
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {draft.steps.map((step, index) => {
                    const primitive = getPrimitiveAction(step.primitiveId);
                    const jsonValue = stepJson[step.id] || '{}';
                    const jsonError = stepJsonError(jsonValue);

                    return (
                      <div key={step.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-gray-900">Step {index + 1}</div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                if (index === 0) return;
                                updateDraft((current) => {
                                  const nextSteps = [...current.steps];
                                  [nextSteps[index - 1], nextSteps[index]] = [nextSteps[index], nextSteps[index - 1]];
                                  return { ...current, steps: nextSteps };
                                });
                              }}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white"
                            >
                              Up
                            </button>
                            <button
                              onClick={() => {
                                if (index === draft.steps.length - 1) return;
                                updateDraft((current) => {
                                  const nextSteps = [...current.steps];
                                  [nextSteps[index], nextSteps[index + 1]] = [nextSteps[index + 1], nextSteps[index]];
                                  return { ...current, steps: nextSteps };
                                });
                              }}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-white"
                            >
                              Down
                            </button>
                            <button
                              onClick={() => {
                                updateDraft((current) => ({
                                  ...current,
                                  steps: current.steps.filter((entry) => entry.id !== step.id),
                                }));
                                setStepJson((current) => {
                                  const next = { ...current };
                                  delete next[step.id];
                                  return next;
                                });
                              }}
                              disabled={draft.steps.length === 1}
                              className="rounded-md border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1.1fr_1fr]">
                          <select
                            value={step.primitiveId}
                            onChange={(event) => {
                              const nextPrimitiveId = event.target.value;
                              const nextPrimitive = getPrimitiveAction(nextPrimitiveId);
                              updateStep(step.id, () => ({
                                ...step,
                                primitiveId: nextPrimitiveId,
                                input: JSON.parse(JSON.stringify(nextPrimitive?.defaultInput || {})) as Record<string, unknown>,
                              }));
                              setStepJson((current) => ({
                                ...current,
                                [step.id]: prettyJson(nextPrimitive?.defaultInput || {}),
                              }));
                            }}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-200"
                          >
                            {primitiveActions.map((primitiveOption) => (
                              <option key={primitiveOption.id} value={primitiveOption.id}>
                                {primitiveOption.label} - {primitiveOption.category}
                              </option>
                            ))}
                          </select>
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500">
                            {primitive?.description}
                          </div>
                        </div>

                        <textarea
                          value={jsonValue}
                          onChange={(event) => setStepJson((current) => ({ ...current, [step.id]: event.target.value }))}
                          rows={8}
                          spellCheck={false}
                          className={`mt-2 w-full rounded-xl border bg-white px-3 py-2 font-mono text-[11px] text-gray-900 focus:outline-none focus:ring-2 ${
                            jsonError ? 'border-red-200 focus:ring-red-100' : 'border-gray-200 focus:ring-orange-200'
                          }`}
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                          <span className="rounded-full bg-white px-2 py-1">Use {"{{tabId}}"}</span>
                          <span className="rounded-full bg-white px-2 py-1">Use {"{{last_ref}}"}</span>
                          {draft.parameters.map((parameter) => (
                            <span key={parameter.id} className="rounded-full bg-white px-2 py-1">
                              {parameterPlaceholder(parameter)}
                            </span>
                          ))}
                        </div>
                        {jsonError && (
                          <div className="mt-2 text-[11px] text-red-600">{jsonError}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {editorError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {editorError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={closeEditor}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDraft}
                  disabled={isSaving}
                  className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : editingMacroId ? 'Save Changes' : 'Save Macro'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 px-4 py-4">
          {macroGroups.map((group) => (
            <section key={group.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{group.label}</div>
                  <div className="text-[11px] text-gray-500">{group.description}</div>
                </div>
                <div className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-500">
                  {group.id === 'global'
                    ? `${primitiveActions.length} primitives, ${group.macros.length} macros`
                    : `${group.macros.length} macros`}
                </div>
              </div>

              {group.id === 'global' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {primitiveActions.map((primitive) => (
                    <div key={primitive.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium text-gray-900">{primitive.label}</div>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          {primitive.category}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600">{primitive.description}</div>
                      <div className="mt-2 text-[11px] text-gray-400">
                        Tool {primitive.toolName}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {group.macros.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-500">
                  {group.id === 'global'
                    ? 'No reusable macros yet. Add one above to combine primitives into a saved workflow.'
                    : 'No macros saved for this site group yet.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {group.macros.map((macro) => (
                    <div key={macro.id} className="rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-gray-900">{macro.name}</div>
                            {isBuiltInMacro(macro) && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                Built-in
                              </span>
                            )}
                            {isRemoteMacro(macro) && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                API
                              </span>
                            )}
                            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                              {scopeSummary(macro)}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">
                            {macro.description || 'No description yet.'}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isBuiltInMacro(macro) ? (
                            <span className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-400">
                              Trace-derived
                            </span>
                          ) : isRemoteMacro(macro) ? (
                            <span className="rounded-lg border border-blue-200 px-2 py-1 text-[11px] font-medium text-blue-600">
                              Managed by POST API
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => openEditMacro(macro)}
                                className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => removeMacro(macro.id)}
                                className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          {macro.steps.length} step{macro.steps.length === 1 ? '' : 's'}
                        </span>
                        {macro.parameters.length > 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-1">
                            {macro.parameters.length} parameter{macro.parameters.length === 1 ? '' : 's'}
                          </span>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-1">
                          {macro.steps.map(stepSummary).join(' -> ')}
                        </span>
                      </div>

                      {macro.parameters.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {macro.parameters.map((parameter) => (
                            <span key={parameter.id} className="rounded-full bg-white px-2 py-1 text-[11px] text-gray-600 ring-1 ring-gray-200">
                              {parameterPlaceholder(parameter)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
