import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useActivity } from "../ActivityContext";
import { api, type ServerSettings } from "../api";

const LANGUAGES: [string, string][] = [
  ["en-US", "English"],
  ["hu-HU", "Magyar"],
  ["de-DE", "Deutsch"],
  ["fr-FR", "Français"],
  ["es-ES", "Español"],
  ["it-IT", "Italiano"],
  ["ja-JP", "日本語"],
];

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
  const { t, i18n } = useTranslation();
  const { refreshSoon } = useActivity();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((loaded) => {
        // First time only: default the metadata language to the UI language.
        if (loaded.tmdb_language === "") {
          const ui = i18n.language.startsWith("hu") ? "hu-HU" : "en-US";
          api.updateSettings({ tmdb_language: ui }).then(setSettings).catch(() => setSettings(loaded));
        } else {
          setSettings(loaded);
        }
      })
      .catch(() => undefined);
  }, [i18n.language]);

  const toggle = (key: "auto_normalize" | "delete_original" | "auto_detect_intro"): void => {
    if (settings === null) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    api
      .updateSettings({ [key]: next[key] })
      .then(setSettings)
      .catch(() => undefined);
  };

  const setLanguage = (value: string): void => {
    if (settings === null) return;
    setSettings({ ...settings, tmdb_language: value });
    api.updateSettings({ tmdb_language: value }).then(setSettings).catch(() => undefined);
  };

  const normalizeAll = (): void => {
    setSweeping(true);
    api.normalizeAll().catch(() => undefined);
    refreshSoon(); // show the spinner next to the bell right away
    window.setTimeout(() => setSweeping(false), 2000);
  };

  const detectIntros = (): void => {
    setDetecting(true);
    api.detectIntros().catch(() => undefined);
    refreshSoon();
    window.setTimeout(() => setDetecting(false), 2000);
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
            label={t("settings.deleteOriginal")}
            description={t("settings.deleteOriginalDesc")}
            on={settings.delete_original}
            onToggle={() => toggle("delete_original")}
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

      {settings !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            {t("settings.introTitle")}
          </h2>
          <Toggle
            label={t("settings.autoDetectIntro")}
            description={t("settings.autoDetectIntroDesc")}
            on={settings.auto_detect_intro}
            onToggle={() => toggle("auto_detect_intro")}
          />
          <button
            onClick={detectIntros}
            disabled={detecting}
            className="rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(168,85,247,0.35)] transition hover:brightness-110 disabled:opacity-60"
          >
            {detecting ? t("settings.detectIntrosStarted") : t("settings.detectIntros")}
          </button>
        </section>
      )}

      {settings !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            {t("settings.metadataTitle")}
          </h2>
          <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">
                {t("settings.metadataLanguage")}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-neutral-400">
                {t("settings.metadataLanguageDesc")}
              </span>
            </span>
            <select
              value={settings.tmdb_language || "en-US"}
              onChange={(event) => setLanguage(event.target.value)}
              className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code} className="bg-[#120e1d]">
                  {name}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}
    </div>
  );
}
