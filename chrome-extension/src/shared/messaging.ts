import type { BGMessage, BGResponse } from './types';

export async function sendToBackground(message: BGMessage): Promise<BGResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BGResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response from background' });
      }
    });
  });
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
