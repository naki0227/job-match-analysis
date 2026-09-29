import { useState } from "react";
import { Tabs, type TabItem } from "../../components/Tabs";
import {
  AccountPane,
  NotificationsPane,
  PreferencesPane,
  PrivacyPane,
  ProfilePane,
} from "./SettingsPanes";
import "./settings.css";

type TabKey =
  "profile" | "preferences" | "privacy" | "notifications" | "account";

const tabs: readonly TabItem<TabKey>[] = [
  { key: "profile", label: "プロフィール" },
  { key: "preferences", label: "希望条件" },
  { key: "privacy", label: "プライバシー" },
  { key: "notifications", label: "通知" },
  { key: "account", label: "アカウント" },
];

type Props = {
  email: string | null;
  onEditProfile: () => void;
  onSignOut: () => Promise<void>;
};

export function SettingsScreen({ email, onEditProfile, onSignOut }: Props) {
  const [tab, setTab] = useState<TabKey>("preferences");
  return (
    <section className="page-head settings" aria-labelledby="settings-heading">
      <div className="eyebrow">SETTINGS</div>
      <h1 id="settings-heading">設定</h1>
      <p className="sub">必要なものだけ。</p>
      <Tabs label="設定の種類" tabs={tabs} selected={tab} onSelect={setTab}>
        {tab === "profile" && <ProfilePane />}
        {tab === "preferences" && (
          <PreferencesPane onEditProfile={onEditProfile} />
        )}
        {tab === "privacy" && <PrivacyPane />}
        {tab === "notifications" && <NotificationsPane />}
        {tab === "account" && (
          <AccountPane email={email} onSignOut={onSignOut} />
        )}
      </Tabs>
    </section>
  );
}
