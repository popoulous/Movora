import { KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useActivity } from "../ActivityContext";
import { api, type Device, type Library, type ServerSettings, type User } from "../api";
import { useAuth } from "../AuthContext";
import { getTvOverride, setTvModeOverride, useTvMode } from "../hooks/useTvMode";

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

function NumberField({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-neutral-400">{description}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => onChange(value - 1)}
          disabled={disabled || value <= 0}
          className="h-8 w-8 rounded-lg bg-white/[0.06] text-lg leading-none text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
        >
          −
        </button>
        <span className="w-8 text-center text-sm font-semibold text-white">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          disabled={disabled || value >= 20}
          className="h-8 w-8 rounded-lg bg-white/[0.06] text-lg leading-none text-neutral-200 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function SettingsPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { refreshSoon } = useActivity();
  const { user } = useAuth();
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const tv = useTvMode();
  const [tvOverride, setTvOverrideState] = useState(() => getTvOverride());

  useEffect(() => {
    const sync = () => setTvOverrideState(getTvOverride());
    window.addEventListener("movora:tvmode", sync);
    return () => window.removeEventListener("movora:tvmode", sync);
  }, []);

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

  const toggle = (
    key:
      | "auto_normalize"
      | "delete_original"
      | "auto_detect_intro"
      | "auto_scan"
      | "device_prefetch"
      | "device_retention",
  ): void => {
    if (settings === null) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    api
      .updateSettings({ [key]: next[key] })
      .then(setSettings)
      .catch(() => undefined);
  };

  const setCount = (
    key: "prepare_ahead_count" | "retain_behind_count",
    value: number,
  ): void => {
    if (settings === null || Number.isNaN(value)) return;
    const clamped = Math.max(0, Math.min(20, Math.trunc(value)));
    setSettings({ ...settings, [key]: clamped });
    api
      .updateSettings({ [key]: clamped })
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
            {t("settings.libraryTitle")}
          </h2>
          <Toggle
            label={t("settings.autoScan")}
            description={t("settings.autoScanDesc")}
            on={settings.auto_scan}
            onToggle={() => toggle("auto_scan")}
          />
        </section>
      )}

      {settings !== null && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            {t("settings.deviceTitle")}
          </h2>
          <Toggle
            label={t("settings.devicePrefetch")}
            description={t("settings.devicePrefetchDesc")}
            on={settings.device_prefetch}
            onToggle={() => toggle("device_prefetch")}
          />
          <NumberField
            label={t("settings.prepareAhead")}
            description={t("settings.prepareAheadDesc")}
            value={settings.prepare_ahead_count}
            onChange={(value) => setCount("prepare_ahead_count", value)}
            disabled={!settings.device_prefetch}
          />
          <Toggle
            label={t("settings.deviceRetention")}
            description={t("settings.deviceRetentionDesc")}
            on={settings.device_retention}
            onToggle={() => toggle("device_retention")}
          />
          <NumberField
            label={t("settings.retainBehind")}
            description={t("settings.retainBehindDesc")}
            value={settings.retain_behind_count}
            onChange={(value) => setCount("retain_behind_count", value)}
            disabled={!settings.device_retention}
          />
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

      <section className="space-y-3">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          {t("settings.displayTitle")}
        </h2>
        <Toggle
          label={t("settings.tvMode")}
          description={t("settings.tvModeDesc")}
          on={tv}
          onToggle={() => setTvModeOverride(!tv)}
        />
        {tvOverride !== null && (
          <button
            onClick={() => setTvModeOverride(null)}
            className="text-xs text-neutral-500 underline transition hover:text-neutral-300"
          >
            {t("settings.tvModeReset")}
          </button>
        )}
      </section>

      <PairDeviceSection t={t} />

      <DevicesSection t={t} />

      {user?.role === "admin" && <UsersSection currentUserId={user.id} t={t} />}
    </div>
  );
}

function DevicesSection({
  t,
}: {
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = (): void => {
    api
      .listDevices()
      .then(setDevices)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  };
  useEffect(() => {
    reload();
  }, []);

  const revoke = (device: Device): void => {
    if (!window.confirm(t("settings.deviceDeleteConfirm", { name: device.name }))) return;
    api.revokeDevice(device.id).then(reload).catch(() => undefined);
  };

  const lastSeen = (device: Device): string =>
    device.last_seen_at !== null
      ? new Date(device.last_seen_at).toLocaleString()
      : t("settings.deviceNever");

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t("settings.devicesTitle")}
      </h2>
      <p className="text-xs leading-relaxed text-neutral-400">{t("settings.devicesDesc")}</p>
      {loaded && devices.length === 0 ? (
        <p className="text-xs text-neutral-500">{t("settings.devicesEmpty")}</p>
      ) : (
        <div className="space-y-1.5">
          {devices.map((device) => (
            <div
              key={device.id}
              className="rounded-xl bg-white/[0.03] px-4 py-2.5 ring-1 ring-white/10"
            >
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">
                  {device.name}
                </span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {t("settings.deviceLastSeen", { when: lastSeen(device) })}
                </span>
                <button
                  onClick={() => revoke(device)}
                  title={t("settings.deviceDelete")}
                  className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-red-500/15 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {device.unsupported.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-neutral-500">
                    {t("settings.deviceUnsupported")}
                  </span>
                  {device.unsupported.map((format) => (
                    <span
                      key={format}
                      className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200 ring-1 ring-amber-400/30"
                    >
                      {format}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {devices.length > 0 && devices[0].variant_count > 0 && (
            <p className="pt-1 text-xs text-neutral-500">
              {t("settings.deviceVariants", { count: devices[0].variant_count })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PairDeviceSection({
  t,
}: {
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const approve = (event: FormEvent): void => {
    event.preventDefault();
    if (code.length < 6 || busy) return;
    setBusy(true);
    setMsg(null);
    api
      .pairApprove(code)
      .then((device) =>
        setMsg({ ok: true, text: t("settings.pairSuccess", { name: device.name }) }),
      )
      .catch(() => setMsg({ ok: false, text: t("settings.pairError") }))
      .finally(() => {
        setBusy(false);
        setCode("");
      });
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t("settings.pairTitle")}
      </h2>
      <p className="text-xs leading-relaxed text-neutral-400">{t("settings.pairDesc")}</p>
      <form onSubmit={approve} className="flex items-center gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          placeholder={t("settings.pairCodePlaceholder")}
          className="w-40 rounded-lg bg-white/[0.06] px-3 py-2 text-sm tracking-[0.3em] text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || code.length < 6}
          className="rounded-xl bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(168,85,247,0.35)] transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? t("settings.pairApproving") : t("settings.pairApprove")}
        </button>
      </form>
      {msg !== null && (
        <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>
      )}
    </section>
  );
}

function UsersSection({
  currentUserId,
  t,
}: {
  currentUserId: number;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element {
  const [users, setUsers] = useState<User[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState<string | null>(null);

  const reload = (): void => {
    api.listUsers().then(setUsers).catch(() => undefined);
  };
  useEffect(() => {
    reload();
    api.listLibraries().then(setLibraries).catch(() => undefined);
  }, []);

  const toggleLibrary = (member: User, libraryId: number): void => {
    const next = member.library_ids.includes(libraryId)
      ? member.library_ids.filter((id) => id !== libraryId)
      : [...member.library_ids, libraryId];
    api.setUserLibraries(member.id, next).then(reload).catch(() => undefined);
  };

  const create = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    api
      .createUser({ username, password, role })
      .then(() => {
        setUsername("");
        setPassword("");
        reload();
      })
      .catch(() => setError(t("settings.userExists")));
  };

  const remove = (id: number): void => {
    api.deleteUser(id).then(reload).catch(() => undefined);
  };

  const resetPassword = (member: User): void => {
    const next = window.prompt(t("settings.resetPasswordPrompt", { name: member.username }));
    if (next === null || next.length < 4) return;
    api
      .resetUserPassword(member.id, next)
      .then(() => window.alert(t("settings.passwordReset")))
      .catch(() => undefined);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
        {t("settings.usersTitle")}
      </h2>
      <div className="space-y-1.5">
        {users.map((member) => (
          <div
            key={member.id}
            className="rounded-xl bg-white/[0.03] px-4 py-2.5 ring-1 ring-white/10"
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">
                {member.username}
              </span>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-neutral-400">
                {t(member.role === "admin" ? "settings.roleAdmin" : "settings.roleUser")}
              </span>
              <button
                onClick={() => resetPassword(member)}
                title={t("settings.resetPassword")}
                className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-violet-300"
              >
                <KeyRound className="h-4 w-4" />
              </button>
              {member.id !== currentUserId && (
                <button
                  onClick={() => remove(member.id)}
                  title={t("settings.deleteUser")}
                  className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition hover:bg-red-500/15 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {member.role === "admin" ? (
              <p className="mt-1 text-xs text-neutral-500">{t("settings.allLibraries")}</p>
            ) : (
              libraries.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {libraries.map((library) => {
                    const granted = member.library_ids.includes(library.id);
                    return (
                      <button
                        key={library.id}
                        onClick={() => toggleLibrary(member, library.id)}
                        className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                          granted
                            ? "bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/40"
                            : "bg-white/5 text-neutral-400 ring-1 ring-white/10 hover:bg-white/10"
                        }`}
                      >
                        {library.name}
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>
        ))}
      </div>
      <form onSubmit={create} className="flex flex-wrap items-center gap-2 pt-1">
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={t("auth.username")}
          className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("auth.password")}
          className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:ring-violet-400/40 focus:outline-none"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as "admin" | "user")}
          className="rounded-lg bg-white/[0.06] px-3 py-2 text-sm text-neutral-100 ring-1 ring-white/10 focus:outline-none"
        >
          <option value="user" className="bg-[#120e1d]">
            {t("settings.roleUser")}
          </option>
          <option value="admin" className="bg-[#120e1d]">
            {t("settings.roleAdmin")}
          </option>
        </select>
        <button
          type="submit"
          disabled={username === "" || password === ""}
          className="rounded-lg bg-gradient-to-r from-[#7A4DFF] to-[#EC4899] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {t("settings.addUser")}
        </button>
      </form>
      {error !== null && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
