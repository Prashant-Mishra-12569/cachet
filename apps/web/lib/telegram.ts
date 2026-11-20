'use client';

/**
 * Telegram Mini App bridge (core.telegram.org/bots/webapps). Only what Cachet uses.
 * The server checks Telegram's signed launch data (initData) on every request; nothing here is trusted.
 */

export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  platform: string;
  ready(): void;
  expand(): void;
  openLink(url: string): void;
  onEvent(event: 'themeChanged', cb: () => void): void;
  offEvent(event: 'themeChanged', cb: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback?: { notificationOccurred(type: 'error' | 'success' | 'warning'): void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SDK_URL = 'https://telegram.org/js/telegram-web-app.js?65';
let loading: Promise<TelegramWebApp | null> | null = null;

/** Load Telegram's script once. Resolves null outside Telegram (or if the script can't load). */
export function loadTelegram(): Promise<TelegramWebApp | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.Telegram?.WebApp) return Promise.resolve(window.Telegram.WebApp);
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    const timer = window.setTimeout(() => resolve(null), 8000);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.Telegram?.WebApp ?? null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** The bot people should open Cachet from (shown outside Telegram). */
export const BOT_USERNAME = process.env['NEXT_PUBLIC_TELEGRAM_BOT_USERNAME'] ?? 'CachetSealBot';
