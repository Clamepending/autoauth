import {
  STORAGE_KEY_AGENT_MACROS,
  STORAGE_KEY_REMOTE_AGENT_MACROS,
} from '../../shared/constants';
import { getDomain } from '../../shared/messaging';
import type {
  AgentMacroAction,
  AgentMacroParameter,
  AgentMacroParameterType,
  AgentMacroScope,
  AgentMacroStep,
  PermissionType,
  ToolResultContent,
} from '../../shared/types';
import { useStore } from '../store';

export type PrimitiveActionCategory =
  | 'Mouse'
  | 'Keyboard'
  | 'Navigation'
  | 'Read'
  | 'Browser'
  | 'Debug'
  | 'Automation';

export interface PrimitiveActionDefinition {
  id: string;
  label: string;
  description: string;
  category: PrimitiveActionCategory;
  toolName: string;
  defaultInput: Record<string, unknown>;
  requiresTabId: boolean;
  permissionType: PermissionType;
  isMutating: boolean;
}

export interface AgentMacroDraft {
  id?: string;
  name: string;
  description: string;
  scope: AgentMacroScope;
  parameters: AgentMacroParameter[];
  steps: AgentMacroStep[];
}

export interface ResolvedMacroStep {
  primitive: PrimitiveActionDefinition;
  toolName: string;
  input: Record<string, unknown>;
}

export interface MacroRuntimeState {
  variables: Record<string, unknown>;
}

export interface MacroSyncResult {
  ok: boolean;
  count?: number;
  updatedAt?: string | null;
  error?: string;
}

export interface MacroGroup {
  id: string;
  label: string;
  description: string;
  macros: AgentMacroAction[];
}

function primitive(
  id: string,
  label: string,
  description: string,
  category: PrimitiveActionCategory,
  toolName: string,
  defaultInput: Record<string, unknown>,
  options: {
    requiresTabId?: boolean;
    permissionType?: PermissionType;
    isMutating?: boolean;
  } = {},
): PrimitiveActionDefinition {
  return {
    id,
    label,
    description,
    category,
    toolName,
    defaultInput,
    requiresTabId: options.requiresTabId ?? true,
    permissionType: options.permissionType ?? 'READ_PAGE_CONTENT',
    isMutating: options.isMutating ?? false,
  };
}

const PRIMITIVE_ACTIONS: PrimitiveActionDefinition[] = [
  primitive(
    'click',
    'Click',
    'Left click an element by ref or coordinate.',
    'Mouse',
    'computer',
    { action: 'left_click', ref: '' },
    { permissionType: 'CLICK', isMutating: true },
  ),
  primitive(
    'right_click',
    'Right Click',
    'Open context menus or secondary click targets.',
    'Mouse',
    'computer',
    { action: 'right_click', ref: '' },
    { permissionType: 'CLICK', isMutating: true },
  ),
  primitive(
    'double_click',
    'Double Click',
    'Double click an element by ref or coordinate.',
    'Mouse',
    'computer',
    { action: 'double_click', ref: '' },
    { permissionType: 'CLICK', isMutating: true },
  ),
  primitive(
    'hover',
    'Hover',
    'Move the mouse over an element to reveal menus or tooltips.',
    'Mouse',
    'computer',
    { action: 'hover', ref: '' },
    { permissionType: 'CLICK' },
  ),
  primitive(
    'drag',
    'Drag',
    'Drag from one coordinate to another.',
    'Mouse',
    'computer',
    { action: 'left_click_drag', start_coordinate: [0, 0], coordinate: [0, 0] },
    { permissionType: 'CLICK', isMutating: true },
  ),
  primitive(
    'press_and_hold',
    'Press & Hold',
    'Press and hold on an element or coordinate for a specified duration in seconds.',
    'Mouse',
    'computer',
    { action: 'press_and_hold', ref: '', duration: 2 },
    { permissionType: 'CLICK', isMutating: true },
  ),
  primitive(
    'type',
    'Type',
    'Type freeform text into the focused element.',
    'Keyboard',
    'computer',
    { action: 'type', text: '' },
    { permissionType: 'TYPE', isMutating: true },
  ),
  primitive(
    'key',
    'Press Key',
    'Send a keyboard shortcut such as enter or cmd+l.',
    'Keyboard',
    'computer',
    { action: 'key', text: 'enter' },
    { permissionType: 'TYPE', isMutating: true },
  ),
  primitive(
    'scroll',
    'Scroll',
    'Scroll the current page in a direction.',
    'Mouse',
    'computer',
    { action: 'scroll', scroll_direction: 'down', scroll_amount: 3 },
  ),
  primitive(
    'scroll_to',
    'Scroll To Ref',
    'Scroll until a referenced element is centered in view.',
    'Mouse',
    'computer',
    { action: 'scroll_to', ref: '' },
  ),
  primitive(
    'wait',
    'Wait',
    'Pause briefly and capture a fresh screenshot.',
    'Automation',
    'computer',
    { action: 'wait', duration: 2 },
  ),
  primitive(
    'navigate',
    'Navigate',
    'Go to a URL or browser history destination.',
    'Navigation',
    'navigate',
    { url: '' },
    { permissionType: 'NAVIGATE', isMutating: true },
  ),
  primitive(
    'read_page',
    'Read Page',
    'Capture the accessibility tree to discover interactive refs.',
    'Read',
    'read_page',
    { filter: 'interactive' },
  ),
  primitive(
    'form_input',
    'Form Input',
    'Set an input, checkbox, or select directly by ref.',
    'Read',
    'form_input',
    { ref: '', value: '' },
    { permissionType: 'TYPE', isMutating: true },
  ),
  primitive(
    'find',
    'Find',
    'Find elements by natural language description.',
    'Read',
    'find',
    { query: '' },
  ),
  primitive(
    'get_page_text',
    'Get Page Text',
    'Extract the main text content from the active page.',
    'Read',
    'get_page_text',
    {},
  ),
  primitive(
    'javascript',
    'JavaScript',
    'Run JavaScript in the page context.',
    'Debug',
    'javascript_tool',
    { action: 'javascript_exec', text: 'document.title' },
    { permissionType: 'TYPE', isMutating: true },
  ),
  primitive(
    'tabs_context',
    'Tabs Context',
    'List the currently open tabs and their IDs.',
    'Browser',
    'tabs_context',
    {},
    { requiresTabId: false },
  ),
  primitive(
    'tabs_create',
    'Create Tab',
    'Open a new browser tab.',
    'Browser',
    'tabs_create',
    {},
    { requiresTabId: false, permissionType: 'NAVIGATE', isMutating: true },
  ),
  primitive(
    'read_console_messages',
    'Read Console',
    'Inspect browser console output for the current tab.',
    'Debug',
    'read_console_messages',
    { onlyErrors: false, clear: false },
  ),
  primitive(
    'read_network_requests',
    'Read Network',
    'Inspect captured HTTP requests for the current tab.',
    'Debug',
    'read_network_requests',
    { clear: false },
  ),
  primitive(
    'upload_image',
    'Upload Image',
    'Upload a previously captured screenshot into a file input.',
    'Browser',
    'upload_image',
    { imageId: '', ref: '' },
    { permissionType: 'UPLOAD_IMAGE', isMutating: true },
  ),
  primitive(
    'file_upload',
    'File Upload',
    'Upload local files into a file input element.',
    'Browser',
    'file_upload',
    { paths: [], ref: '' },
    { permissionType: 'UPLOAD_IMAGE', isMutating: true },
  ),
  primitive(
    'resize_window',
    'Resize Window',
    'Resize the browser window.',
    'Browser',
    'resize_window',
    { width: 1280, height: 800 },
    { permissionType: 'NAVIGATE', isMutating: true },
  ),
  primitive(
    'update_plan',
    'Update Plan',
    'Ask the user to approve a multi-step plan before proceeding.',
    'Automation',
    'update_plan',
    { domains: [], approach: [] },
    { requiresTabId: false, permissionType: 'PLAN_APPROVAL' },
  ),
];

const primitiveById = new Map(PRIMITIVE_ACTIONS.map((entry) => [entry.id, entry]));
const BUILTIN_MACROS: AgentMacroAction[] = [
  {
    id: 'builtin_amazon_search_query',
    origin: 'builtin',
    name: 'Amazon Search Query',
    description: 'Derived from successful Amazon traces. Finds the Amazon header search box, fills the query, and submits it.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [
      {
        id: 'builtin_amazon_search_query_param_query',
        name: 'query',
        description: 'The search text to enter in the Amazon search box.',
        type: 'string',
        required: true,
        defaultValue: '',
      },
    ],
    steps: [
      { id: 'builtin_amazon_search_query_step_find', primitiveId: 'find', input: { query: 'Search Amazon search box' } },
      { id: 'builtin_amazon_search_query_step_fill', primitiveId: 'form_input', input: { ref: '{{last_ref}}', value: '{{query}}' } },
      { id: 'builtin_amazon_search_query_step_submit', primitiveId: 'key', input: { text: 'Return' } },
      { id: 'builtin_amazon_search_query_step_wait', primitiveId: 'wait', input: { duration: 2 } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'builtin_amazon_open_first_result',
    origin: 'builtin',
    name: 'Amazon Open First Result',
    description: 'Derived from Amazon result-page traces. Opens the first plausible product result from the current search results page.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [],
    steps: [
      { id: 'builtin_amazon_open_first_result_step_find', primitiveId: 'find', input: { query: 'first product result in main search results area' } },
      { id: 'builtin_amazon_open_first_result_step_click', primitiveId: 'click', input: { ref: '{{last_ref}}' } },
      { id: 'builtin_amazon_open_first_result_step_wait', primitiveId: 'wait', input: { duration: 2 } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'builtin_amazon_search_and_open_first_result',
    origin: 'builtin',
    name: 'Amazon Search And Open First Result',
    description: 'Combines the two most common successful Amazon trace patterns: search from the header and open the first plausible result.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [
      {
        id: 'builtin_amazon_search_and_open_first_result_param_query',
        name: 'query',
        description: 'The product query to search for on Amazon.',
        type: 'string',
        required: true,
        defaultValue: '',
      },
    ],
    steps: [
      { id: 'builtin_amazon_search_and_open_first_result_step_find_search', primitiveId: 'find', input: { query: 'Search Amazon search box' } },
      { id: 'builtin_amazon_search_and_open_first_result_step_fill_search', primitiveId: 'form_input', input: { ref: '{{last_ref}}', value: '{{query}}' } },
      { id: 'builtin_amazon_search_and_open_first_result_step_submit', primitiveId: 'key', input: { text: 'Return' } },
      { id: 'builtin_amazon_search_and_open_first_result_step_wait_for_results', primitiveId: 'wait', input: { duration: 2 } },
      { id: 'builtin_amazon_search_and_open_first_result_step_find_result', primitiveId: 'find', input: { query: 'first product result in main search results area' } },
      { id: 'builtin_amazon_search_and_open_first_result_step_open_result', primitiveId: 'click', input: { ref: '{{last_ref}}' } },
      { id: 'builtin_amazon_search_and_open_first_result_step_wait_for_product', primitiveId: 'wait', input: { duration: 2 } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'builtin_amazon_add_to_cart',
    origin: 'builtin',
    name: 'Amazon Add To Cart',
    description: 'Based on successful add-to-cart traces. Finds the main Add to cart button on the current product page and clicks it.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [],
    steps: [
      { id: 'builtin_amazon_add_to_cart_step_find', primitiveId: 'find', input: { query: 'Add to cart button' } },
      { id: 'builtin_amazon_add_to_cart_step_click', primitiveId: 'click', input: { ref: '{{last_ref}}' } },
      { id: 'builtin_amazon_add_to_cart_step_wait', primitiveId: 'wait', input: { duration: 2 } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'builtin_amazon_open_cart',
    origin: 'builtin',
    name: 'Amazon Open Cart',
    description: 'A direct-cart shortcut from successful traces. Navigates straight to the Amazon cart page.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [],
    steps: [
      { id: 'builtin_amazon_open_cart_step_navigate', primitiveId: 'navigate', input: { url: 'https://www.amazon.com/gp/cart/view.html' } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'builtin_amazon_proceed_to_checkout',
    origin: 'builtin',
    name: 'Amazon Proceed To Checkout',
    description: 'Looks for the standard Proceed to checkout control on Amazon cart or add-to-cart confirmation pages.',
    scope: { type: 'domain', label: 'Amazon', domainPattern: 'amazon.com' },
    parameters: [],
    steps: [
      { id: 'builtin_amazon_proceed_to_checkout_step_find', primitiveId: 'find', input: { query: 'Proceed to checkout button' } },
      { id: 'builtin_amazon_proceed_to_checkout_step_click', primitiveId: 'click', input: { ref: '{{last_ref}}' } },
      { id: 'builtin_amazon_proceed_to_checkout_step_wait', primitiveId: 'wait', input: { duration: 2 } },
    ],
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-10T00:00:00.000Z',
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function titleCaseToken(value: string): string {
  if (!value) return 'Site';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function normalizeDomainPattern(value: string): string {
  let normalized = safeString(value).toLowerCase();
  if (!normalized) return '';
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/\/.*$/, '');
  normalized = normalized.replace(/^\*\./, '');
  normalized = normalized.replace(/^www\./, '');
  return normalized.replace(/\.+$/, '');
}

export function labelFromDomain(domainPattern: string): string {
  const normalized = normalizeDomainPattern(domainPattern);
  const labelRoot = normalized.split('.').filter(Boolean)[0] || 'site';
  return titleCaseToken(labelRoot);
}

function normalizeScope(scope: AgentMacroScope | undefined): AgentMacroScope {
  if (!scope || scope.type === 'global') {
    return { type: 'global', label: 'All websites' };
  }
  const domainPattern = normalizeDomainPattern(scope.domainPattern || '');
  return {
    type: 'domain',
    label: safeString(scope.label) || labelFromDomain(domainPattern || 'site'),
    domainPattern,
  };
}

function normalizeParameterName(value: string, usedNames: Set<string>): string {
  const base = slugify(value).replace(/^[^a-z]+/, '') || 'param';
  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function normalizeParameterType(value: unknown): AgentMacroParameterType {
  return value === 'number' || value === 'boolean' ? value : 'string';
}

function normalizeParameter(
  raw: unknown,
  index: number,
  usedNames: Set<string>,
): AgentMacroParameter | null {
  if (!isPlainObject(raw)) return null;
  const name = normalizeParameterName(raw.name ? String(raw.name) : `param_${index + 1}`, usedNames);
  return {
    id: safeString(raw.id) || makeId('param'),
    name,
    description: safeString(raw.description),
    type: normalizeParameterType(raw.type),
    required: raw.required !== false,
    defaultValue: raw.defaultValue === undefined ? '' : String(raw.defaultValue),
  };
}

function normalizeStep(raw: unknown): AgentMacroStep | null {
  if (!isPlainObject(raw)) return null;
  const primitiveId = safeString(raw.primitiveId);
  if (!primitiveById.has(primitiveId)) return null;
  return {
    id: safeString(raw.id) || makeId('step'),
    primitiveId,
    input: isPlainObject(raw.input) ? deepClone(raw.input) : deepClone(getPrimitiveAction(primitiveId)!.defaultInput),
  };
}

function sortMacros(macros: AgentMacroAction[]): AgentMacroAction[] {
  return [...macros].sort((left, right) => {
    const leftGroup = getScopeKey(left.scope);
    const rightGroup = getScopeKey(right.scope);
    return leftGroup.localeCompare(rightGroup)
      || macroOriginRank(left.origin).localeCompare(macroOriginRank(right.origin))
      || left.name.localeCompare(right.name);
  });
}

function macroOriginRank(origin: AgentMacroAction['origin']): string {
  switch (origin) {
    case 'builtin':
      return '0_builtin';
    case 'remote':
      return '1_remote';
    default:
      return '2_user';
  }
}

function normalizeMacro(raw: unknown): AgentMacroAction | null {
  if (!isPlainObject(raw)) return null;
  const name = safeString(raw.name);
  if (!name) return null;

  const parametersUsed = new Set<string>();
  const parameters = Array.isArray(raw.parameters)
    ? raw.parameters
      .map((entry, index) => normalizeParameter(entry, index, parametersUsed))
      .filter((entry): entry is AgentMacroParameter => Boolean(entry))
    : [];

  const steps = Array.isArray(raw.steps)
    ? raw.steps
      .map((entry) => normalizeStep(entry))
      .filter((entry): entry is AgentMacroStep => Boolean(entry))
    : [];

  if (steps.length === 0) return null;

  const scope = normalizeScope(raw.scope as AgentMacroScope | undefined);
  const timestamp = new Date().toISOString();

  return {
    id: safeString(raw.id) || makeId('macro'),
    name,
    description: safeString(raw.description),
    scope,
    parameters,
    steps,
    createdAt: safeString(raw.createdAt) || timestamp,
    updatedAt: safeString(raw.updatedAt) || timestamp,
    origin: raw.origin === 'builtin'
      ? 'builtin'
      : raw.origin === 'remote'
        ? 'remote'
        : 'user',
  };
}

function readStoredMacros(raw: unknown): AgentMacroAction[] {
  if (!Array.isArray(raw)) return [];
  return sortMacros(
    raw
      .map((entry) => normalizeMacro(entry))
      .filter((entry): entry is AgentMacroAction => Boolean(entry)),
  );
}

function mergeBuiltInMacros(macros: AgentMacroAction[]): AgentMacroAction[] {
  const merged = new Map<string, AgentMacroAction>();
  for (const macro of BUILTIN_MACROS) {
    merged.set(macro.id, macro);
  }
  for (const macro of macros) {
    merged.set(macro.id, macro);
  }
  return sortMacros(Array.from(merged.values()));
}

function getPersistableMacros(macros: AgentMacroAction[]): AgentMacroAction[] {
  return macros.filter((entry) => entry.origin === 'user');
}

function getRemotePersistableMacros(macros: AgentMacroAction[]): AgentMacroAction[] {
  return macros.filter((entry) => entry.origin === 'remote');
}

async function persistMacroSets(args: {
  userMacros?: AgentMacroAction[];
  remoteMacros?: AgentMacroAction[];
}): Promise<AgentMacroAction[]> {
  const payload: Record<string, AgentMacroAction[]> = {};
  if (args.userMacros) {
    payload[STORAGE_KEY_AGENT_MACROS] = readStoredMacros(getPersistableMacros(args.userMacros));
  }
  if (args.remoteMacros) {
    payload[STORAGE_KEY_REMOTE_AGENT_MACROS] = readStoredMacros(getRemotePersistableMacros(args.remoteMacros));
  }
  await chrome.storage.local.set(payload);
  return await loadAgentMacros();
}

export function getPrimitiveActions(): PrimitiveActionDefinition[] {
  return PRIMITIVE_ACTIONS;
}

export function getPrimitiveAction(id: string): PrimitiveActionDefinition | undefined {
  return primitiveById.get(id);
}

export function createBlankMacroParameter(): AgentMacroParameter {
  return {
    id: makeId('param'),
    name: 'value',
    description: '',
    type: 'string',
    required: true,
    defaultValue: '',
  };
}

export function createBlankMacroStep(primitiveId = 'click'): AgentMacroStep {
  const primitiveDef = getPrimitiveAction(primitiveId) || PRIMITIVE_ACTIONS[0];
  return {
    id: makeId('step'),
    primitiveId: primitiveDef.id,
    input: deepClone(primitiveDef.defaultInput),
  };
}

export function createBlankMacroDraft(): AgentMacroDraft {
  return {
    name: '',
    description: '',
    scope: { type: 'global', label: 'All websites' },
    parameters: [],
    steps: [createBlankMacroStep()],
  };
}

export async function loadAgentMacros(): Promise<AgentMacroAction[]> {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_AGENT_MACROS,
    STORAGE_KEY_REMOTE_AGENT_MACROS,
  ]);
  const userMacros = readStoredMacros(result[STORAGE_KEY_AGENT_MACROS]);
  const remoteMacros = readStoredMacros(result[STORAGE_KEY_REMOTE_AGENT_MACROS])
    .map((macro) => ({ ...macro, origin: 'remote' as const }));
  const merged = mergeBuiltInMacros([
    ...remoteMacros,
    ...userMacros,
  ]);
  useStore.getState().setActionMacros(merged);
  return merged;
}

export async function saveAgentMacro(draft: AgentMacroDraft): Promise<AgentMacroAction> {
  const existingMacro = useStore.getState().actionMacros.find((entry) => entry.id === draft.id);
  const nextMacro = normalizeMacro({
    ...draft,
    id: existingMacro?.origin === 'builtin' ? undefined : draft.id,
    updatedAt: new Date().toISOString(),
    createdAt: draft.id && existingMacro?.origin !== 'builtin'
      ? existingMacro?.createdAt
      : new Date().toISOString(),
  });

  if (!nextMacro) {
    throw new Error('Macro needs a name and at least one valid step.');
  }

  const nextMacros = [
    ...getPersistableMacros(useStore.getState().actionMacros).filter((entry) => entry.id !== nextMacro.id),
    nextMacro,
  ];
  await persistMacroSets({ userMacros: nextMacros });
  return nextMacro;
}

export async function deleteAgentMacro(macroId: string): Promise<void> {
  const nextMacros = getPersistableMacros(useStore.getState().actionMacros).filter((entry) => entry.id !== macroId);
  await persistMacroSets({ userMacros: nextMacros });
}

export function isBuiltInMacro(macro: AgentMacroAction): boolean {
  return macro.origin === 'builtin';
}

export function isRemoteMacro(macro: AgentMacroAction): boolean {
  return macro.origin === 'remote';
}

export async function replaceRemoteAgentMacros(rawMacros: unknown): Promise<AgentMacroAction[]> {
  const remoteMacros = readStoredMacros(rawMacros)
    .map((macro) => ({ ...macro, origin: 'remote' as const }));
  return await persistMacroSets({ remoteMacros });
}

export async function syncRemoteAgentMacros(serverUrl: string): Promise<MacroSyncResult> {
  const baseUrl = String(serverUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: 'Local control URL is not configured.' };
  }

  try {
    const response = await fetch(`${baseUrl}/macros`);
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: text || `HTTP ${response.status}` };
    }
    const payload = text ? JSON.parse(text) as { macros?: unknown; updatedAt?: string | null } : {};
    const merged = await replaceRemoteAgentMacros(Array.isArray(payload.macros) ? payload.macros : []);
    const remoteCount = merged.filter((macro) => macro.origin === 'remote').length;
    return {
      ok: true,
      count: remoteCount,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getScopeKey(scope: AgentMacroScope): string {
  return scope.type === 'global'
    ? 'global'
    : normalizeDomainPattern(scope.domainPattern || scope.label || 'site');
}

export function getMacroGroups(macros: AgentMacroAction[]): MacroGroup[] {
  const groups = new Map<string, MacroGroup>();
  groups.set('global', {
    id: 'global',
    label: 'All websites',
    description: 'Primitive actions plus any reusable macros that apply everywhere.',
    macros: [],
  });

  for (const macro of sortMacros(macros)) {
    const key = getScopeKey(macro.scope);
    if (!groups.has(key)) {
      const domainPattern = normalizeDomainPattern(macro.scope.domainPattern || macro.scope.label);
      groups.set(key, {
        id: key,
        label: macro.scope.label,
        description: `Macros that become available when the active page matches ${domainPattern || macro.scope.label}.`,
        macros: [],
      });
    }
    groups.get(key)!.macros.push(macro);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.id === 'global') return -1;
    if (right.id === 'global') return 1;
    return left.label.localeCompare(right.label);
  });
}

export function macroMatchesUrl(macro: AgentMacroAction, url: string): boolean {
  if (macro.scope.type === 'global') return true;
  const hostname = getDomain(url);
  const pattern = normalizeDomainPattern(macro.scope.domainPattern || '');
  if (!hostname || !pattern) return false;
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

export function getApplicableMacros(macros: AgentMacroAction[], url: string): AgentMacroAction[] {
  return sortMacros(macros.filter((macro) => macroMatchesUrl(macro, url)));
}

export function getMacroToolName(macro: AgentMacroAction): string {
  const base = slugify(`macro_${macro.scope.label}_${macro.name}_${macro.id.slice(-4)}`) || `macro_${macro.id.slice(-4)}`;
  return base.slice(0, 64);
}

export function findMacroByToolName(macros: AgentMacroAction[], toolName: string): AgentMacroAction | null {
  return macros.find((entry) => getMacroToolName(entry) === toolName) || null;
}

export function getMacroPermissionType(macro: AgentMacroAction): PermissionType {
  const priority: Record<PermissionType, number> = {
    READ_PAGE_CONTENT: 0,
    TYPE: 1,
    CLICK: 2,
    UPLOAD_IMAGE: 3,
    PLAN_APPROVAL: 4,
    NAVIGATE: 5,
  };
  return macro.steps.reduce<PermissionType>((current, step) => {
    const primitiveDef = getPrimitiveAction(step.primitiveId);
    if (!primitiveDef) return current;
    return priority[primitiveDef.permissionType] > priority[current]
      ? primitiveDef.permissionType
      : current;
  }, 'READ_PAGE_CONTENT');
}

export function isMacroMutating(macro: AgentMacroAction): boolean {
  return macro.steps.some((step) => getPrimitiveAction(step.primitiveId)?.isMutating);
}

export function getMacroToolDefinitions(macros: AgentMacroAction[], activeUrl: string): Array<Record<string, unknown>> {
  return getApplicableMacros(macros, activeUrl).map((macro) => {
    const properties: Record<string, unknown> = {
      tabId: { type: 'number', description: 'Optional tab ID. Defaults to the active tab.' },
    };

    for (const param of macro.parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description || `Parameter ${param.name} for macro ${macro.name}.`,
      };
    }

    const required = macro.parameters
      .filter((param) => param.required)
      .map((param) => param.name);
    const stepLabels = macro.steps
      .map((step) => getPrimitiveAction(step.primitiveId)?.label || step.primitiveId)
      .join(' -> ');
    const scopeLine = macro.scope.type === 'global'
      ? 'Available on all websites.'
      : `Available when the active site matches ${macro.scope.domainPattern}.`;

    return {
      name: getMacroToolName(macro),
      description: `${macro.name}. ${macro.description || 'Saved site workflow.'} ${scopeLine} Steps: ${stepLabels}.`,
      input_schema: {
        type: 'object' as const,
        properties,
        required,
      },
    };
  });
}

function coerceValue(type: AgentMacroParameterType, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (type === 'number') {
    const asNumber = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    throw new Error(`Expected a number but received "${String(value)}".`);
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      if (lowered === 'true') return true;
      if (lowered === 'false') return false;
    }
    throw new Error(`Expected a boolean but received "${String(value)}".`);
  }
  return String(value);
}

function buildMacroVariables(
  macro: AgentMacroAction,
  rawInput: Record<string, unknown>,
  activeTabId: number | null,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  const explicitTabId = typeof rawInput.tabId === 'number' ? rawInput.tabId : activeTabId;
  if (explicitTabId !== null) {
    variables.tabId = explicitTabId;
    variables.activeTabId = explicitTabId;
  }

  for (const parameter of macro.parameters) {
    const inputValue = rawInput[parameter.name];
    const fallbackValue = parameter.defaultValue;
    const resolved = coerceValue(
      parameter.type,
      inputValue !== undefined && inputValue !== null && inputValue !== '' ? inputValue : fallbackValue,
    );
    if (resolved === undefined && parameter.required) {
      throw new Error(`Macro "${macro.name}" is missing required parameter "${parameter.name}".`);
    }
    if (resolved !== undefined) {
      variables[parameter.name] = resolved;
    }
  }

  return variables;
}

export function createMacroRuntimeState(
  macro: AgentMacroAction,
  rawInput: Record<string, unknown>,
  activeTabId: number | null,
): MacroRuntimeState {
  return { variables: buildMacroVariables(macro, rawInput, activeTabId) };
}

function resolveTemplateString(template: string, variables: Record<string, unknown>): unknown {
  const exactMatch = template.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);
  if (exactMatch) {
    const key = exactMatch[1];
    if (!(key in variables)) {
      throw new Error(`Missing macro variable "${key}".`);
    }
    return variables[key];
  }

  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key: string) => {
    if (!(key in variables)) {
      throw new Error(`Missing macro variable "${key}".`);
    }
    return String(variables[key]);
  });
}

function resolveTemplateValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return resolveTemplateString(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveTemplateValue(entry, variables));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveTemplateValue(entry, variables)]),
    );
  }
  return value;
}

export function resolveMacroStep(
  macro: AgentMacroAction,
  step: AgentMacroStep,
  runtimeState: MacroRuntimeState,
): ResolvedMacroStep {
  const primitiveDef = getPrimitiveAction(step.primitiveId);
  if (!primitiveDef) {
    throw new Error(`Unknown primitive action "${step.primitiveId}" in macro "${macro.name}".`);
  }

  const resolved = resolveTemplateValue(step.input, runtimeState.variables);
  const partialInvocation = isPlainObject(resolved) ? deepClone(resolved) : {};
  const invocation = {
    ...deepClone(primitiveDef.defaultInput),
    ...partialInvocation,
  };

  if (primitiveDef.requiresTabId && typeof invocation.tabId !== 'number') {
    const tabId = runtimeState.variables.tabId;
    if (typeof tabId !== 'number') {
      throw new Error(`Macro "${macro.name}" requires an active tab.`);
    }
    invocation.tabId = tabId;
  }

  return {
    primitive: primitiveDef,
    toolName: primitiveDef.toolName,
    input: invocation,
  };
}

function extractRefsFromText(text: string): string[] {
  const matches = text.match(/\bref_\d+\b/g) || [];
  return Array.from(new Set(matches));
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)"']+/i);
  return match ? match[0] : null;
}

export function applyMacroStepResult(
  runtimeState: MacroRuntimeState,
  stepIndex: number,
  result: ToolResultContent[],
): MacroRuntimeState {
  const text = result
    .filter((entry): entry is Extract<ToolResultContent, { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
    .trim();
  const refs = text ? extractRefsFromText(text) : [];
  const maybeUrl = text ? extractFirstUrl(text) : null;
  const nextVariables: Record<string, unknown> = {
    ...runtimeState.variables,
    last_step_index: stepIndex,
    last_text: text,
    [`step_${stepIndex}_text`]: text,
  };

  if (refs.length > 0) {
    nextVariables.last_ref = refs[0];
    nextVariables.last_refs = refs;
    nextVariables[`step_${stepIndex}_first_ref`] = refs[0];
    nextVariables[`step_${stepIndex}_refs`] = refs;
  }

  if (maybeUrl) {
    nextVariables.last_url = maybeUrl;
    nextVariables[`step_${stepIndex}_url`] = maybeUrl;
  }

  return { variables: nextVariables };
}

export function buildActionLibraryPrompt(macros: AgentMacroAction[], activeUrl: string): string {
  const primitiveLine = getPrimitiveActions()
    .map((primitiveDef) => primitiveDef.id)
    .join(', ');
  const applicableMacros = getApplicableMacros(macros, activeUrl);
  const macroLines = applicableMacros.length > 0
    ? applicableMacros.map((macro) => {
      const params = macro.parameters.length > 0
        ? ` Params: ${macro.parameters.map((param) => `${param.name}${param.required ? '' : '?'}`).join(', ')}.`
        : '';
      const steps = macro.steps
        .map((step) => getPrimitiveAction(step.primitiveId)?.label || step.primitiveId)
        .join(' -> ');
      return `  - ${getMacroToolName(macro)}: ${macro.name} (${macro.scope.label}). ${macro.description || 'Saved workflow.'} Steps: ${steps}.${params}`;
    }).join('\n')
    : '  No saved macros match the current site.';

  return `<action_library>
Primitive actions available everywhere: ${primitiveLine}.
Saved macros currently available on this site:
${macroLines}
Use a saved macro when it directly matches the user's goal on the current site.
</action_library>`;
}
