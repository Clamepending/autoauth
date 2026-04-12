import type { PermissionMode, PermissionType, PermissionDuration, PermissionGrant } from '../../shared/types';
import { useStore } from '../store';

type PermissionResolver = (granted: boolean, duration: PermissionDuration) => void;

class PermissionManager {
  private grants: PermissionGrant[] = [];
  private mode: PermissionMode = 'allow_all';
  private planApprovedDomains: Set<string> = new Set();

  setMode(mode: PermissionMode) {
    this.mode = mode;
    if (mode !== 'follow_a_plan') {
      this.planApprovedDomains.clear();
    }
  }

  approvePlanDomains(domains: string[]) {
    for (const d of domains) this.planApprovedDomains.add(d);
  }

  async checkPermission(
    domain: string,
    permType: PermissionType,
    toolName: string,
    toolUseId: string,
  ): Promise<boolean> {
    if (this.mode === 'allow_all') return true;

    if (this.mode === 'follow_a_plan') {
      if (this.planApprovedDomains.has(domain)) return true;
    }

    const existing = this.grants.find(
      (g) => g.domain === domain && g.type === permType && g.duration === 'always',
    );
    if (existing) return true;

    const once = this.grants.find(
      (g) => g.domain === domain && g.type === permType && g.duration === 'once' && g.toolUseId === toolUseId,
    );
    if (once) {
      this.grants = this.grants.filter((g) => g !== once);
      return true;
    }

    return this.promptUser(domain, permType, toolName, toolUseId);
  }

  private promptUser(
    domain: string,
    permType: PermissionType,
    toolName: string,
    _toolUseId: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const resolver: PermissionResolver = (granted, duration) => {
        if (granted) {
          this.grants.push({ domain, type: permType, duration });
        }
        useStore.getState().setPermissionRequest(null);
        resolve(granted);
      };

      useStore.getState().setPermissionRequest({
        id,
        domain,
        permissionType: permType,
        toolName,
        resolve: resolver,
      });
    });
  }

  getPermissionTypeForAction(toolName: string, action?: string): PermissionType {
    if (toolName === 'navigate') return 'NAVIGATE';
    if (toolName === 'upload_image') return 'UPLOAD_IMAGE';
    if (toolName === 'update_plan') return 'PLAN_APPROVAL';

    if (toolName === 'computer') {
      switch (action) {
        case 'screenshot':
        case 'scroll':
        case 'scroll_to':
        case 'zoom':
          return 'READ_PAGE_CONTENT';
        case 'type':
        case 'key':
          return 'TYPE';
        case 'left_click':
        case 'right_click':
        case 'double_click':
        case 'triple_click':
        case 'press_and_hold':
        case 'hover':
        case 'left_click_drag':
          return 'CLICK';
        default:
          return 'READ_PAGE_CONTENT';
      }
    }

    if (['read_page', 'get_page_text', 'find', 'read_console_messages', 'read_network_requests'].includes(toolName)) {
      return 'READ_PAGE_CONTENT';
    }

    if (['form_input', 'javascript_tool'].includes(toolName)) {
      return 'TYPE';
    }

    return 'READ_PAGE_CONTENT';
  }

  reset() {
    this.grants = [];
    this.planApprovedDomains.clear();
  }
}

export const permissionManager = new PermissionManager();
