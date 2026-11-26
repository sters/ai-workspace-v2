import { SettingsEditor } from "@/components/utilities/settings-editor";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function UserSettingsPage() {
  useDocumentTitle("Claude Settings: User");
  return <SettingsEditor scope="user" />;
}
