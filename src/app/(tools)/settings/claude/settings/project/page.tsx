import { SettingsEditor } from "@/components/utilities/settings-editor";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ProjectSettingsPage() {
  useDocumentTitle("Claude Settings: Project");
  return <SettingsEditor scope="project" />;
}
