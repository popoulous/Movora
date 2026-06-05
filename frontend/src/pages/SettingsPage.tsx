import { useTranslation } from "react-i18next";

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
      <p className="mt-2 text-neutral-400">{t("settings.subtitle")}</p>
    </div>
  );
}
