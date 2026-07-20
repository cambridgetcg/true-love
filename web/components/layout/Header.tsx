"use client";

import { Sun, Moon, Monitor, ChevronDown } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { useChatStore } from "@/lib/store";
import { MODELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

export function Header() {
  const { theme, setTheme } = useTheme();
  const { settings, updateSettings, conversations, activeConversationId } = useChatStore();

  const activeTitle =
    conversations.find((c) => c.id === activeConversationId)?.title ?? "New conversation";

  const themeIcons = {
    light: Sun,
    dark: Moon,
    system: Monitor,
  } as const;

  const ThemeIcon = themeIcons[theme];
  const nextTheme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-surface-800 bg-surface-900/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-sm font-medium text-surface-200 truncate" title={activeTitle}>
          {activeTitle}
        </h1>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Model selector */}
        <label htmlFor="model-select" className="sr-only">
          Model
        </label>
        <div className="relative">
          <select
            id="model-select"
            value={settings.model}
            onChange={(e) => updateSettings({ model: e.target.value })}
            className={cn(
              "appearance-none text-xs bg-surface-800 border border-surface-700 rounded-md pl-2.5 pr-7 py-1.5",
              "text-surface-300 hover:text-surface-100 hover:border-surface-600 cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            )}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500"
            aria-hidden="true"
          />
        </div>

        {/* Notification center */}
        <NotificationCenter />

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(nextTheme)}
          title={`Theme: ${THEME_LABEL[theme]} — switch to ${THEME_LABEL[nextTheme]}`}
          aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme]}.`}
          className="p-1.5 rounded-md text-surface-400 hover:text-surface-100 hover:bg-surface-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ThemeIcon className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
