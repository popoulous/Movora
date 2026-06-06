import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type ServerSettings } from "../api";

function Toggle({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-start justify-between gap-4 rounded-xl bg-white/[0.03] p-4 text-left ring-1 ring-white/10 transition hover:bg-white/[0.05]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-neutral-400">{description}</span>
      </span>
      <span
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
          on ? "bg-gradient-to-r from-[#7A4DFF] to-[#EC4899]" : "bg-white/10"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-5" : ""}`}
        />
      </span>
    </button>
  );
}

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  const toggle = (key: keyof ServerSettings): void => {
    if (settings === null) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    api
      .updateSettings({ [key]: next[key] })
      .then(setSettings)
      .catch(() => undefined);
  };

  const normalizeAll = (): void => {
    setSweeping(true);
    api.normalizeAll().catch(() => undefined);
    window.setTimeout(() => setSweeping(false), 2000);
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="mt-2 text-neutral-400">{t("settings.subtitle")}</p>
      </div>

      {settings !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            {t("settings.playbackTitle")}
          </h2>
          <Toggle
            label={t("settings.autoNormalize")}
            description={t("settings.autoNormalizeDesc")}
            on={settings.auto_normalize}
            onToggle={() => toggle("auto_normalize")}
          />
          <Toggle
            label={t("settings.autoNormalizeExisting")}
            description={t("settings.autoNormalizeExistingDesc")}
            on={settings.auto_normalize_existing}
            onToggle={() => toggle("auto_normalize_existing")}
          />
          <button
            onClick={normalizeAll}
            disabled={sweeping}
            className="rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(168,85,247,0.35)] transition hover:brightness-110 disabled:opacity-60"
          >
            {sweeping ? t("settings.normalizeAllStarted") : t("settings.normalizeAll")}
          </button>
        </section>
      )}
    </div>
  );
}
