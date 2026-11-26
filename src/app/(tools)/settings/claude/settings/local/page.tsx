import { SettingsEditor } from "@/components/utilities/settings-editor";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function LocalSettingsPage() {
  useDocumentTitle("Claude Settings: Local");
  return <SettingsEditor scope="local" />;
}
